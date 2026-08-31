import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSafeInternalPath } from "@/lib/auth/redirect";
import { prisma } from "@/lib/prisma";
import { fetchKakaoAccount, fetchAgreedTermTags } from "@/lib/kakao/account";
import { getChannelRelation } from "@/lib/kakao/channel";
import { isKakaoSyncEnabled } from "@/lib/kakao/scopes";
import { storeKakaoRefreshToken } from "@/lib/kakao/token";
import { claimGuestSavedQuotes } from "@/lib/guest-quote-claim";
import { allocateUniqueReferralCode } from "@/lib/referral/ensure-code";
import {
  REFERRAL_COOKIE_MAX_AGE_SEC,
  REFERRAL_COOKIE_NAME,
} from "@/lib/referral/attribution";
import { normalizeReferralCode } from "@/lib/referral/code";

const metadataSchema = z.record(z.unknown());

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = getSafeInternalPath(searchParams.get("next"));
  const redirectOrigin = getRedirectOrigin(origin);

  if (!code) {
    return NextResponse.redirect(`${redirectOrigin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data?.user) {
    console.error("[auth/callback] exchangeCodeForSession error:", error);
    return NextResponse.redirect(`${redirectOrigin}/login?error=auth_failed`);
  }

  const user = data.user;
  try {
    const existingUser = await prisma.user.findUnique({
      where: { supabaseId: user.id },
      select: { isActive: true },
    });
    if (existingUser && !existingUser.isActive) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "global" });
      if (signOutError) {
        console.error("[auth/callback] inactive account sign-out failed:", signOutError.message);
      }
      return NextResponse.redirect(`${redirectOrigin}/login?error=account_inactive`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[auth/callback] local account status lookup failed:", message);
    return NextResponse.redirect(`${redirectOrigin}/login?error=temporarily_unavailable`);
  }

  const providerToken =
    typeof data.session?.provider_token === "string" ? data.session.provider_token : null;
  // 견적서 전송은 로그인 한참 뒤에 일어나는데 Supabase 는 provider_token 을 보관하지 않는다.
  // 리프레시 토큰을 암호화 저장해뒀다가 그때 액세스 토큰을 재발급한다.
  const providerRefreshToken =
    typeof data.session?.provider_refresh_token === "string"
      ? data.session.provider_refresh_token
      : null;
  const metaResult = metadataSchema.safeParse(user.user_metadata);
  const appMetaResult = metadataSchema.safeParse(user.app_metadata);
  const meta = metaResult.success ? metaResult.data : {};
  const appMeta = appMetaResult.success ? appMetaResult.data : {};
  const provider = typeof appMeta.provider === "string" ? appMeta.provider : null;
  // Supabase 카카오 provider 는 user_metadata 에 nickname 키를 만들지 않는다.
  // 닉네임은 name / preferred_username / user_name 에 담겨 온다(실측 확인).
  const metaNickname =
    provider === "kakao"
      ? pickString(meta, ["preferred_username", "user_name", "name", "nickname"])
      : null;
  // 카카오 이메일 미동의 시 빈 문자열을 반환 → unique 충돌 방지를 위해 null 로 정규화.
  const normalizedEmail = user.email && user.email.trim() ? user.email : null;
  // 카카오 전화번호: 동의 항목(전화번호) 승인 시 Supabase user.phone 또는 user_metadata 에 담긴다.
  // 카카오는 "+82 10-1234-5678" 형태로 내려줌 — 저장은 원본, 채널톡 전달 시 toE164KR 로 +82 정규화.
  const rawPhone =
    (typeof user.phone === "string" && user.phone.trim() && user.phone) ||
    (typeof meta.phone_number === "string" && meta.phone_number.trim() && meta.phone_number) ||
    (typeof meta.phone === "string" && meta.phone.trim() && meta.phone) ||
    null;
  const normalizedPhone = rawPhone ? rawPhone.trim() : null;
  const displayName =
    (typeof meta.name === "string" && meta.name) ||
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.nickname === "string" && meta.nickname) ||
    normalizedEmail?.split("@")[0] ||
    "회원";

  // 카카오싱크: provider_token 으로 사용자 정보·약관동의·채널추가 상태를 보강한다.
  // Supabase 세션 메타에는 실명/채널관계가 실리지 않으므로 카카오 API 를 직접 조회한다.
  // 미동의·미승인 항목은 값이 없어 no-op — 로그인 흐름엔 영향 없다.
  const useSync = provider === "kakao" && providerToken !== null && isKakaoSyncEnabled();
  const kakaoAccessToken = useSync ? providerToken : null;

  const channelId = process.env.KAKAO_CHANNEL_ID?.trim();
  const accountPromise = kakaoAccessToken
    ? fetchKakaoAccount(kakaoAccessToken)
    : Promise.resolve(null);
  const channelRelationPromise =
    kakaoAccessToken && channelId
      ? getChannelRelation(kakaoAccessToken, channelId)
      : Promise.resolve(null);
  const agreedTagsPromise = kakaoAccessToken
    ? fetchAgreedTermTags(kakaoAccessToken)
    : Promise.resolve([]);
  const [account, channelRelation, agreedTags] = await Promise.all([
    accountPromise,
    channelRelationPromise,
    agreedTagsPromise,
  ]);

  const marketingTag = process.env.KAKAO_MARKETING_TERMS_TAG?.trim() || "marketing";
  const marketingConsent = agreedTags.includes(marketingTag);
  // 카카오싱크 채널추가 동의 문구가 광고·마케팅 수신 동의를 겸하지만, 서비스 약관이 아니라
  // 약관 tag 로 잡히지 않는다. 그래서 채널 추가 상태로도 동의를 인정한다.
  // 단 최초 가입(동의창을 실제로 통과한 시점)에만 적용한다 — 기존 회원에 적용하면
  // 마이페이지에서 수신을 철회해도 채널을 추가해둔 이상 재로그인마다 되살아난다.
  // (KAKAO_CHANNEL_ID 미설정 시 channelRelation 이 null 이라 이 경로는 동작하지 않는다)
  const signupMarketingConsent = marketingConsent || channelRelation === "ADDED";

  const resolvedPhone = normalizedPhone ?? account?.phone ?? null;
  // 동의항목 "이름"으로 받은 실명이 있으면 닉네임 기반 표시명보다 우선한다.
  const resolvedName = account?.name ?? displayName;
  const resolvedEmail = normalizedEmail ?? account?.email ?? null;
  // 카카오 API 의 프로필 닉네임을 우선하고, 없으면 Supabase 메타에서 받은 값을 쓴다.
  const kakaoNickname = account?.nickname ?? metaNickname;

  // 로그인 URL 의 ?ref= 도 쿠키에 심어 가입 완료 시 추천 인정에 쓴다.
  const refFromQuery = normalizeReferralCode(searchParams.get("ref"));

  let dbUser: { role: string; profileCompleted: boolean } | null = null;
  try {
    const newReferralCode = await allocateUniqueReferralCode(prisma);
    dbUser = await prisma.user.upsert({
      where: { supabaseId: user.id },
      update: {
        lastLoginAt: new Date(),
        // 이미 존재하는 사용자의 role/isActive 는 보존. 동의로 받은 값만 최신화한다.
        ...(resolvedEmail ? { email: resolvedEmail } : {}),
        ...(kakaoNickname ? { kakaoNickname } : {}),
        ...(resolvedPhone ? { phone: resolvedPhone } : {}),
        ...(account?.name ? { name: account.name } : {}),
        ...(account?.kakaoId ? { kakaoId: account.kakaoId } : {}),
        ...(channelRelation ? { channelRelation } : {}),
        // 동의는 단조 증가 — 이번 로그인에서 동의했을 때만 켜고, 끄지 않는다(철회는 별도 경로).
        ...(marketingConsent ? { marketingConsent: true } : {}),
        ...(useSync ? { consentedAt: new Date() } : {}),
      },
      create: {
        supabaseId: user.id,
        email: resolvedEmail,
        name: resolvedName,
        role: "member",
        provider,
        kakaoId: account?.kakaoId ?? null,
        kakaoNickname,
        phone: resolvedPhone,
        channelRelation,
        marketingConsent: signupMarketingConsent,
        consentedAt: useSync ? new Date() : null,
        isActive: true,
        lastLoginAt: new Date(),
        referralCode: newReferralCode,
      },
      select: { role: true, profileCompleted: true },
    });
    // upsert 로 행이 보장된 뒤에 저장한다(암호화 키 미설정 시 내부에서 no-op).
    if (useSync) {
      await storeKakaoRefreshToken(user.id, providerRefreshToken);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    // upsert 실패 시 세션만 살아있는 유령 로그인이 되어 마이페이지·게이트 판정이
    // 전부 실패한다. 이 브라우저의 세션만 정리하고 되돌린다.
    // scope 는 local — 일시적 DB 장애로 다른 기기의 멀쩡한 세션까지 무효화하면
    // "가만히 있어도 로그아웃되는" 사고가 된다. global 은 비활성 계정 차단 전용.
    console.error("[auth/callback] user upsert failed:", message);
    const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
    if (signOutError) {
      console.error("[auth/callback] failed signup sign-out error:", signOutError.message);
    }
    return NextResponse.redirect(`${redirectOrigin}/login?error=signup_failed`);
  }

  // 이어서 보기: 게스트로 저장한 견적을 이 브라우저의 capability 쿠키로
  // 회원 계정에 귀속한다(마이페이지 노출). best-effort — 실패해도 로그인은 계속되고,
  // 귀속 조건이 userId: null 이라 재로그인 시 no-op 다(멱등).
  try {
    const claimed = await claimGuestSavedQuotes(request.headers.get("cookie"), user.id);
    if (claimed > 0) {
      console.log(`[auth/callback] claimed ${claimed} guest quote(s)`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[auth/callback] guest quote claim failed:", message);
  }

  // 간편가입 미완료 회원(이름·전화 미수집)은 가입완료 폼으로 유도한다.
  // 어드민 계열/이미 완료한 회원은 원래 목적지(next)로 바로 이동.
  const redirectUrl =
    dbUser && dbUser.role === "member" && !dbUser.profileCompleted
      ? `${redirectOrigin}/welcome?next=${encodeURIComponent(next)}`
      : `${redirectOrigin}${next}`;

  const response = NextResponse.redirect(redirectUrl);
  if (refFromQuery) {
    response.cookies.set(REFERRAL_COOKIE_NAME, refFromQuery, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: REFERRAL_COOKIE_MAX_AGE_SEC,
    });
  }
  return response;
}

/** 메타데이터에서 첫 번째로 값이 있는 키를 고른다. */
function pickString(meta: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getRedirectOrigin(requestOrigin: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.origin;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error("[auth/callback] redirect origin fallback:", message);
    }
  }

  return new URL(requestOrigin).origin;
}

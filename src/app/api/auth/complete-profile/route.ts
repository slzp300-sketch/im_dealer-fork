import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/require-user";
import { toDomesticKR } from "@/lib/phone";
import { REFERRAL_COOKIE_NAME } from "@/lib/referral/attribution";
import { applyReferralOnProfileComplete } from "@/lib/referral/apply";
import { ensureUserReferralCode } from "@/lib/referral/ensure-code";
import { normalizeReferralCode } from "@/lib/referral/code";
import { signupIpHashFromRequest } from "@/lib/referral/signup-ip";
import { reconcileUserCoupons } from "@/lib/coupons/reconcile";
import { sendSignupCompletedAlimtalk } from "@/lib/signup-completed-alimtalk";

// 간편가입 완료: 로그인 회원의 이름·전화(필수)와 마케팅 동의(선택)를 저장하고
// profileCompleted 를 true 로 표시한다. /welcome 폼에서 호출한다.
const schema = z.object({
  name: z.string().trim().min(2, "이름을 2자 이상 입력해주세요.").max(20),
  phone: z.string().trim().min(1, "전화번호를 입력해주세요."),
  marketingConsent: z.boolean().default(false),
  // 추천인 코드 직접 입력(선택). 추천 링크 쿠키가 없어도 코드만으로 인정받는 경로.
  referralCode: z.string().trim().max(10).optional(),
});

type TypedCodeCheck =
  | { ok: true; code: string | null }
  | { ok: false; message: string };

// 입력 코드는 profileCompleted 가 켜지기 전에 검증한다. 켜진 뒤에는 추천 인정이
// 불가능(NOT_NEW_PROFILE)한데 오타를 그때 알려주면 고칠 기회가 없기 때문이다.
// 존재/비활성은 같은 문구로 답해 코드 존재 여부를 구분해 노출하지 않는다.
async function checkTypedReferralCode(
  raw: string | undefined,
  inviteeUserId: string,
): Promise<TypedCodeCheck> {
  if (!raw) return { ok: true, code: null };

  const code = normalizeReferralCode(raw);
  if (!code) {
    return { ok: false, message: "추천인 코드 형식이 올바르지 않습니다. (예: K4821)" };
  }
  const inviter = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, isActive: true },
  });
  if (!inviter || !inviter.isActive) {
    return { ok: false, message: "추천인 코드를 확인해주세요. 사용할 수 없는 코드입니다." };
  }
  if (inviter.id === inviteeUserId) {
    return { ok: false, message: "본인의 추천 코드는 입력할 수 없습니다." };
  }
  return { ok: true, code };
}

export async function POST(request: NextRequest) {
  const { user, error: authError } = await requireActiveUser();
  if (authError) return authError;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "입력값이 올바르지 않습니다.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const phone = toDomesticKR(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: "전화번호 형식이 올바르지 않습니다. (예: 010-1234-5678)" },
      { status: 400 }
    );
  }

  const wasProfileCompleted = user.profileCompleted;
  const completedAt = new Date();
  const referralFromCookie = request.cookies.get(REFERRAL_COOKIE_NAME)?.value ?? null;

  // 이미 가입 완료된 회원의 재호출에서는 코드가 어차피 인정될 수 없으므로 검증하지 않는다.
  let typedReferralCode: string | null = null;
  if (!wasProfileCompleted) {
    let check: TypedCodeCheck;
    try {
      check = await checkTypedReferralCode(parsed.data.referralCode, user.id);
    } catch (err) {
      console.error("[POST /api/auth/complete-profile] referral code check failed:", err);
      return NextResponse.json({ error: "저장 중 오류가 발생했습니다." }, { status: 500 });
    }
    if (!check.ok) {
      return NextResponse.json({ error: check.message }, { status: 400 });
    }
    typedReferralCode = check.code;
  }

  let ownReferralCode = "";
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        name: parsed.data.name,
        phone,
        marketingConsent: parsed.data.marketingConsent,
        profileCompleted: true,
        // 추천 코드 사후 입력 창구(14일)의 기준 시각. 최초 완료 때만 기록한다.
        ...(!wasProfileCompleted ? { profileCompletedAt: completedAt } : {}),
      },
    });

    // 본인 추천 코드 확보 (추천인 페이지·공유용)
    ownReferralCode = await ensureUserReferralCode(user.id, prisma);

    // 기존 SIGNUP 쿠폰 등 동기화
    if (user.supabaseId) {
      await reconcileUserCoupons({
        id: user.id,
        supabaseId: user.supabaseId,
        profileCompleted: true,
      });
    }
  } catch (err) {
    console.error("[POST /api/auth/complete-profile]", err);
    return NextResponse.json({ error: "저장 중 오류가 발생했습니다." }, { status: 500 });
  }

  // 최초 가입 완료 시에만 추천 인정. 직접 입력한 코드가 쿠키보다 우선한다.
  // 가입 저장과 분리해 처리한다 — 인정이 일시 오류로 실패해도 가입은 성공이고,
  // 트랜잭션 롤백 덕분에 회원이 창구(14일) 안에 쿠폰함 카드로 다시 시도할 수 있다.
  const referralRawCode = typedReferralCode ?? referralFromCookie;
  let referralApplyFailed = false;
  let referralAttempted = false;
  let referralApplied = false;
  if (!wasProfileCompleted && referralRawCode) {
    referralAttempted = true;
    try {
      const result = await prisma.$transaction((tx) =>
        applyReferralOnProfileComplete(
          {
            inviteeUserId: user.id,
            rawCode: referralRawCode,
            isWithinEntryWindow: true,
            inviteeKakaoId: user.kakaoId ?? null,
            signupIpHash: signupIpHashFromRequest(request),
          },
          tx,
        ),
      );
      referralApplied = result.applied;
      if (!result.applied) {
        console.info("[complete-profile] referral not applied:", result.reason);
      }
    } catch (err) {
      referralApplyFailed = true;
      console.error("[complete-profile] referral apply failed:", err);
    }
  }

  // 회원가입 완료 알림톡. 최초 완료 때만 보내고, 적재 실패가 가입 성공을 되돌리면 안 된다.
  if (!wasProfileCompleted) {
    try {
      await sendSignupCompletedAlimtalk({
        userId: user.id,
        name: parsed.data.name,
        phone,
        referralCode: ownReferralCode,
        signedUpAt: completedAt,
      });
    } catch (err) { // no-excuse-ok: catch — 알림톡 실패가 가입 완료를 되돌리면 안 됨
      console.error("[complete-profile] signup alimtalk enqueue failed:", err);
    }
  }

  // 추천 인정 결과 표면화: 삼켜진 실패/거절을 클라이언트가 알 수 있게 한다.
  // 시도가 없었으면 필드를 보내지 않는다(코드 없는 일반 가입과 구분).
  const response = NextResponse.json({
    success: true,
    ...(referralAttempted ? { referralApplied } : {}),
  });
  // 소비된 추천 쿠키 제거. 인정이 일시 오류로 실패한 경우에는 남겨둔다.
  if (referralFromCookie && !referralApplyFailed) {
    response.cookies.set(REFERRAL_COOKIE_NAME, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

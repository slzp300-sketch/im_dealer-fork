import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getTrustedClientIp } from "@/lib/client-ip";
import { apiRateLimit, strictRateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/prisma";
import { ADMIN_ROLES } from "@/lib/admin-roles";
import {
  getVehicleImageE2EAdmin,
  VEHICLE_IMAGE_E2E_ADMIN_COOKIE,
} from "@/lib/vehicle-images/e2e-admin-session";

// Next 16 의 proxy.ts 는 항상 Node.js 런타임으로 실행됨 → runtime export 불필요.
// Prisma 직접 호출 가능. https://nextjs.org/docs/messages/middleware-to-proxy

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");

  // ── API 라우트 Rate Limit 보호 ────────────────────────────────────
  // strict: 실제로 리소스 무거운 / 어뷰징 위험 큰 경로만 (AI 추천, 이미지 생성, 파일 업로드)
  // 단순 견적 조회/계산/저장은 일반 apiRateLimit 으로 강등 — 비교/옵션 변경 시 정상 사용자가 걸리지 않게
  const isUploadApi = pathname === "/api/admin/upload";
  const isCronApi = pathname.startsWith("/api/cron/");
  // cron 은 CRON_SECRET Bearer 가 본 인증. Vercel cron 은 XFF 가 없어
  // IP 게이트에 넣으면 운영에서 400/unknown 공용 버킷을 소진한다.
  if (pathname.startsWith("/api/") && !isCronApi && (!isAdminApi || isUploadApi)) {
    const isStrictApi =
      isUploadApi ||
      pathname.startsWith("/api/recommend") ||
      pathname === "/api/quote/image";
    const ratelimit = isStrictApi ? strictRateLimit : apiRateLimit;

    if (ratelimit) {
      const ip = getTrustedClientIp(request.headers);
      const isProdRemote =
        process.env.NODE_ENV === "production" && !isLocalHostname(request.nextUrl.hostname);
      if (!ip && isProdRemote) {
        console.warn("[proxy] client IP unavailable — using unknown bucket", { pathname });
      }
      const rateKey = ip ?? (isProdRemote ? "unknown" : "local-dev");
      // fail-open: Upstash 장애·쿼터 초과가 전 API 500 으로 번지면 안 된다.
      // 제한이 잠시 풀리는 것이 서비스 전면 장애보다 낫다.
      let verdict: Awaited<ReturnType<typeof ratelimit.limit>> | null = null;
      try {
        verdict = await ratelimit.limit(rateKey);
      } catch (error: unknown) {
        console.error("[proxy] rate limit check failed — failing open", {
          pathname,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (verdict && !verdict.success) {
        const { limit, reset, remaining } = verdict;
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          {
            status: 429,
            headers: {
              "X-RateLimit-Limit": limit.toString(),
              "X-RateLimit-Remaining": remaining.toString(),
              "X-RateLimit-Reset": reset.toString(),
            },
          }
        );
      }
    }
  }

  // ── 요청 헤더에 현재 경로 주입 (서버 컴포넌트에서 pathname 인지용) ────
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  // ── Supabase 세션 갱신 ───────────────────────────────────
  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  if (process.env.VEHICLE_IMAGE_STORAGE_DRIVER === "filesystem-e2e") {
    const e2eAdmin = await getVehicleImageE2EAdmin(request.cookies.get(VEHICLE_IMAGE_E2E_ADMIN_COOKIE)?.value);
    if (isAdminApi && !e2eAdmin) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    if (isAdminPage && !e2eAdmin) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", "/admin");
      return NextResponse.redirect(loginUrl);
    }
    return supabaseResponse;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Supabase 환경변수가 설정되지 않았습니다." },
        { status: 500 }
      );
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      // src/lib/supabase/server.ts 와 동일 정책 — 운영 세션 쿠키는 secure 강제.
      cookieOptions: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // ── 어드민 라우트 보호 (DB 기준 단일 출처) ─────────────────────────
  // Supabase 메타데이터가 아닌 prisma.user.role 을 진실로 삼는다. 권한 변경 즉시 반영.
  if (isAdminPage || isAdminApi) {
    let isAdmin = false;
    if (user) {
      try {
        const dbUser = await prisma.user.findUnique({
          where: { supabaseId: user.id },
          select: { role: true, isActive: true },
        });
        isAdmin =
          !!dbUser?.isActive &&
          (ADMIN_ROLES as readonly string[]).includes(dbUser?.role ?? "");
      } catch (error: unknown) {
        console.error("[proxy] DB role check failed:", error instanceof Error ? error.message : "unknown error");
        // 안전한 기본값: 차단. DB 장애로 권한 우회되는 것보다 거부가 낫다.
        isAdmin = false;
      }
    }

    if (isAdminApi) {
      if (!isAdmin) {
        return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
      }
    } else {
      if (!isAdmin) {
        if (user) {
          // 로그인은 됐지만 관리자 권한 없음 → 홈으로
          return NextResponse.redirect(new URL("/", request.url));
        } else {
          // 비로그인 → 메인 로그인 페이지로
          const loginUrl = new URL("/login", request.url);
          loginUrl.searchParams.set("next", "/admin");
          return NextResponse.redirect(loginUrl);
        }
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

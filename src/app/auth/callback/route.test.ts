import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  findUnique: vi.fn(),
  upsert: vi.fn(),
  allocateUniqueReferralCode: vi.fn(),
  claimQuotes: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      signOut: mocks.signOut,
    },
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
    savedQuote: {
      updateMany: mocks.claimQuotes,
    },
  },
}));

vi.mock("@/lib/kakao/account", () => ({
  fetchKakaoAccount: vi.fn(),
  fetchAgreedTermTags: vi.fn(),
}));

vi.mock("@/lib/kakao/channel", () => ({ getChannelRelation: vi.fn() }));
vi.mock("@/lib/kakao/scopes", () => ({ isKakaoSyncEnabled: () => false }));
vi.mock("@/lib/kakao/token", () => ({ storeKakaoRefreshToken: vi.fn() }));
vi.mock("@/lib/referral/ensure-code", () => ({
  allocateUniqueReferralCode: mocks.allocateUniqueReferralCode,
}));

import { GET } from "./route";
import {
  createVerificationCapability,
  hashVerificationCapability,
  verificationCapabilityCookieName,
} from "@/lib/verification-capability";

function authUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "supabase-member-1",
    email: "member@example.com",
    user_metadata: {},
    app_metadata: {},
    phone: null,
    ...overrides,
  };
}

function callbackRequest(query: string) {
  return new Request(`https://app.example/auth/callback${query}`);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example");
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        user: authUser(),
        session: null,
      },
      error: null,
    });
    mocks.findUnique.mockResolvedValue({ isActive: true });
    mocks.upsert.mockResolvedValue({ role: "member", profileCompleted: true });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.allocateUniqueReferralCode.mockResolvedValue("ABC12");
    mocks.claimQuotes.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the referral cookie when the callback carries ?ref=", async () => {
    const response = await GET(
      callbackRequest("?code=code-1&next=/mypage/coupons&ref=k4821"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example/mypage/coupons",
    );
    expect(response.headers.get("set-cookie")).toContain("referral_code=K4821");
  });

  it("completes a normal callback and keeps the exchanged session", async () => {
    const response = await GET(callbackRequest("?code=code-1&next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/mypage");
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("code-1");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { supabaseId: "supabase-member-1" },
      select: { isActive: true },
    });
    expect(mocks.upsert).toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("keeps the session and returns a safe error when account status lookup fails", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db connection refused"));

    const response = await GET(callbackRequest("?code=code-1&next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example/login?error=temporarily_unavailable",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("revokes the newly exchanged session and returns an inactive account to login", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        user: authUser({ id: "supabase-inactive-member" }),
        session: null,
      },
      error: null,
    });
    mocks.findUnique.mockResolvedValue({ isActive: false });

    const response = await GET(callbackRequest("?code=code-1&next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login?error=account_inactive");
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { supabaseId: "supabase-inactive-member" },
      select: { isActive: true },
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects a callback without an authorization code", async () => {
    const response = await GET(callbackRequest("?next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login?error=no_code");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not sign out when session exchange fails for a stale code", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "invalid or expired code" },
    });

    const response = await GET(callbackRequest("?code=stale-code&next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login?error=auth_failed");
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("does not treat a failed account lookup as a successful login", async () => {
    mocks.findUnique.mockRejectedValue(new Error("db connection refused"));

    const response = await GET(callbackRequest("?code=code-1&next=/mypage"));

    expect(response.headers.get("location")).not.toBe("https://app.example/mypage");
    expect(response.headers.get("location")).not.toBe("https://app.example/welcome?next=%2Fmypage");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("signs out and redirects with an error when user upsert throws a non-Error value", async () => {
    // upsert 실패 시 유령 세션(DB 행 없는 로그인)을 남기지 않는다.
    // scope 는 local — 일시적 DB 장애로 이 브라우저의 로그인이 실패했다고
    // 다른 기기의 멀쩡한 세션까지 무효화하지 않는다(global 은 비활성 계정 전용).
    mocks.upsert.mockRejectedValue("upsert exploded");

    const response = await GET(callbackRequest("?code=code-1&next=/mypage"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://app.example/login?error=signup_failed",
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("게스트 견적 capability 쿠키가 있으면 로그인 성공 시 회원 계정에 귀속한다", async () => {
    const capQuote1 = createVerificationCapability();
    const capQuote2 = createVerificationCapability();
    const request = new Request(
      "https://app.example/auth/callback?code=code-1&next=/mypage",
      {
        headers: {
          cookie: [
            "imd_nav=1",
            `${verificationCapabilityCookieName("guest-quote-session-1")}=${capQuote1}`,
            "unrelated=noise",
            `${verificationCapabilityCookieName("guest-quote-session-2")}=${capQuote2}`,
          ].join("; "),
        },
      },
    );

    mocks.claimQuotes.mockResolvedValue({ count: 2 });

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/mypage");
    expect(mocks.signOut).not.toHaveBeenCalled();
    // 귀속 predicate 는 /api/verification/consent 의 원자적 클레임과 동일한 조건이다:
    // 미귀속(userId null) · 미삭제 · 미만료 + capability 해시 소유 증명.
    // mypage(getMyPageData)는 where { userId, deletedAt: null } 로 조회하므로
    // data.userId 가 심어진 게스트 견적이 로그인 직후 마이페이지에 노출된다.
    expect(mocks.claimQuotes).toHaveBeenCalledTimes(1);
    expect(mocks.claimQuotes).toHaveBeenCalledWith({
      where: {
        userId: null,
        deletedAt: null,
        expiresAt: { gt: expect.any(Date) },
        verificationCapabilityHash: {
          in: [
            hashVerificationCapability(capQuote1),
            hashVerificationCapability(capQuote2),
          ],
        },
      },
      data: { userId: "supabase-member-1", verificationCapabilityHash: null },
    });
  });

  it("capability 쿠키가 없으면 게스트 견적 귀속을 시도하지 않는다(no-op)", async () => {
    const request = new Request(
      "https://app.example/auth/callback?code=code-1&next=/mypage",
      { headers: { cookie: "imd_nav=1; other=noise" } },
    );

    const response = await GET(request);

    expect(response.headers.get("location")).toBe("https://app.example/mypage");
    expect(mocks.claimQuotes).not.toHaveBeenCalled();
  });

  it("게스트 견적 귀속 실패가 로그인을 깨지 않는다(best-effort)", async () => {
    const cap = createVerificationCapability();
    const request = new Request(
      "https://app.example/auth/callback?code=code-1&next=/mypage",
      {
        headers: {
          cookie: `${verificationCapabilityCookieName("guest-quote-session")}=${cap}`,
        },
      },
    );
    mocks.claimQuotes.mockRejectedValue(new Error("db connection refused"));

    const response = await GET(request);

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/mypage");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("재로그인(이미 귀속된 견적)에서도 클레임은 멱등하게 no-op 이다", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-19T00:00:00.000Z") });
    const cap = createVerificationCapability();
    const request = new Request(
      "https://app.example/auth/callback?code=code-1&next=/mypage",
      {
        headers: {
          cookie: `${verificationCapabilityCookieName("guest-quote-session")}=${cap}`,
        },
      },
    );

    try {
      await GET(request);
      await GET(request);

      // 두 로그인 모두 동일 predicate 로 호출되지만, 첫 클레임에서
      // data.userId 가 심어지고 verificationCapabilityHash 가 null 로 지워지므로
      // 두 번째 호출은 매칭 행이 없다(Prisma in 은 null 행에 매칭되지 않음).
      expect(mocks.claimQuotes).toHaveBeenCalledTimes(2);
      const first = mocks.claimQuotes.mock.calls[0][0];
      const second = mocks.claimQuotes.mock.calls[1][0];
      expect(first.where.userId).toBeNull();
      expect(first.data.verificationCapabilityHash).toBeNull();
      expect(second).toEqual(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

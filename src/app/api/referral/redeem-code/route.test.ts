import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashIp } from "@/lib/ip-hash";
import { REFERRAL_ENTRY_WINDOW_DAYS } from "@/lib/referral/attribution";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  findUniqueUser: vi.fn(),
  transaction: vi.fn(),
  applyReferralOnProfileComplete: vi.fn(),
  checkRateLimit: vi.fn(async (): Promise<Response | null> => null),
}));

/** $transaction 콜백에 넘어가는 tx 클라이언트 표식 */
const TX = { __tx: true };

vi.mock("@/lib/require-user", () => ({
  requireActiveUser: mocks.requireActiveUser,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUniqueUser },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/lib/referral/apply", () => ({
  applyReferralOnProfileComplete: mocks.applyReferralOnProfileComplete,
}));

vi.mock("@/lib/rate-limit", () => ({
  referralRedeemRateLimit: {},
  checkRateLimit: mocks.checkRateLimit,
}));

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function request(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://example.com/api/referral/redeem-code", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  });
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    kakaoId: null,
    profileCompleted: true,
    profileCompletedAt: new Date(NOW - 2 * DAY),
    isActive: true,
    ...overrides,
  };
}

describe("POST /api/referral/redeem-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ user: activeUser(), error: null });
    mocks.findUniqueUser.mockResolvedValue({ id: "inviter-1", isActive: true });
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(TX));
    mocks.applyReferralOnProfileComplete.mockResolvedValue({
      applied: true,
      inviterUserId: "inviter-1",
      referralId: "ref-1",
    });
  });

  it("비로그인은 401", async () => {
    mocks.requireActiveUser.mockResolvedValue({
      user: null,
      error: new Response(JSON.stringify({ error: "로그인이 필요합니다." }), { status: 401 }),
    });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(401);
  });

  it("코드가 비어 있으면 400", async () => {
    const res = await POST(request({ code: "" }));
    expect(res.status).toBe(400);
    expect(mocks.applyReferralOnProfileComplete).not.toHaveBeenCalled();
  });

  it("간편가입 미완료 회원은 400", async () => {
    mocks.requireActiveUser.mockResolvedValue({
      user: activeUser({ profileCompleted: false, profileCompletedAt: null }),
      error: null,
    });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(400);
    expect(mocks.applyReferralOnProfileComplete).not.toHaveBeenCalled();
  });

  it("가입 후 입력 기간이 지나면 400", async () => {
    mocks.requireActiveUser.mockResolvedValue({
      user: activeUser({
        profileCompletedAt: new Date(
          NOW - (REFERRAL_ENTRY_WINDOW_DAYS + 1) * DAY,
        ),
      }),
      error: null,
    });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("기간");
    expect(mocks.applyReferralOnProfileComplete).not.toHaveBeenCalled();
  });

  it("형식이 잘못된 코드는 400", async () => {
    const res = await POST(request({ code: "AB123" }));
    expect(res.status).toBe(400);
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
  });

  it("존재하지 않는 코드는 400", async () => {
    mocks.findUniqueUser.mockResolvedValue(null);
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(400);
    expect(mocks.applyReferralOnProfileComplete).not.toHaveBeenCalled();
  });

  it("본인 코드는 400", async () => {
    mocks.findUniqueUser.mockResolvedValue({ id: "user-1", isActive: true });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(400);
    expect(mocks.applyReferralOnProfileComplete).not.toHaveBeenCalled();
  });

  it("이미 추천이 적용된 계정은 409", async () => {
    mocks.applyReferralOnProfileComplete.mockResolvedValue({
      applied: false,
      reason: "ALREADY_ATTRIBUTED",
    });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toContain("이미");
  });

  it("월 한도 등 기타 거절 사유는 일반 문구로 409", async () => {
    mocks.applyReferralOnProfileComplete.mockResolvedValue({
      applied: false,
      reason: "MONTHLY_CAP",
    });
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).not.toContain("한도");
  });

  it("성공 시 창구 열림으로 apply 를 호출하고 200", async () => {
    const res = await POST(request({ code: "b7777" }));
    expect(res.status).toBe(200);
    expect(mocks.applyReferralOnProfileComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        inviteeUserId: "user-1",
        rawCode: "B7777",
        isWithinEntryWindow: true,
      }),
      expect.anything(),
    );
  });

  it("가입 IP 해시를 추천 인정에 전달한다 (없으면 null)", async () => {
    await POST(request({ code: "K4821" }, { "x-forwarded-for": "5.6.7.8" }));
    expect(mocks.applyReferralOnProfileComplete).toHaveBeenCalledWith(
      expect.objectContaining({ signupIpHash: hashIp("5.6.7.8") }),
      expect.anything(),
    );

    vi.clearAllMocks();
    mocks.requireActiveUser.mockResolvedValue({ user: activeUser(), error: null });
    mocks.findUniqueUser.mockResolvedValue({ id: "inviter-1", isActive: true });
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(TX));
    mocks.applyReferralOnProfileComplete.mockResolvedValue({
      applied: true,
      inviterUserId: "inviter-1",
      referralId: "ref-1",
    });
    await POST(request({ code: "K4821" }));
    expect(mocks.applyReferralOnProfileComplete).toHaveBeenCalledWith(
      expect.objectContaining({ signupIpHash: null }),
      expect.anything(),
    );
  });

  it("추천 인정은 트랜잭션 클라이언트로 실행된다", async () => {
    await POST(request({ code: "K4821" }));
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.applyReferralOnProfileComplete).toHaveBeenCalledWith(
      expect.anything(),
      TX,
    );
  });

  it("트랜잭션 실패 시 500 — 롤백되므로 재시도하면 처음부터 인정 가능", async () => {
    mocks.transaction.mockRejectedValue(new Error("db hiccup"));
    const res = await POST(request({ code: "K4821" }));
    expect(res.status).toBe(500);
  });

  it("returns 429 after 5 redeem attempts in the current minute", async () => {
    let hits = 0;
    mocks.checkRateLimit.mockImplementation(async () => {
      hits += 1;
      if (hits <= 5) return null;
      return new Response(JSON.stringify({ error: "잠시 후 다시 시도해 주세요." }), {
        status: 429,
        headers: { "Retry-After": "60", "Content-Type": "application/json" },
      });
    });

    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await POST(request({ code: "K4821" }))).status);
    }

    expect(statuses.slice(0, 5).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(mocks.applyReferralOnProfileComplete).toHaveBeenCalledTimes(5);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    quoteDelivery: { findMany: mocks.findMany, findUnique: mocks.findUnique },
  },
}));

import { dispatchQuoteDeliveryByPhone } from "./dispatch";

// 매칭 판정만 검증한다. findUnique 가 not_found 를 돌려주게 두면 실제 발송
// (savedQuote 조회·이미지·적재)까지 내려가지 않는다.
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(null);
});

describe("dispatchQuoteDeliveryByPhone", () => {
  // User.phone 은 가입 경로에 따라 "010-…" 와 "+82 10-…" 가 섞여 있다.
  // DB 동등 비교로는 놓치므로 정규화 비교여야 한다.
  it("저장 형식이 달라도 같은 번호면 매칭한다", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "d-domestic", user: { phone: "010-1234-5678" } },
    ]);

    await dispatchQuoteDeliveryByPhone("+821012345678");

    // 매칭된 건으로 발송 경로에 진입했는지 — findUnique(id) 호출로 확인한다.
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-domestic" } })
    );
  });

  it("카카오 원본 형식(+82 10-…)도 매칭한다", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "d-kakao", user: { phone: "+82 10-1234-5678" } },
    ]);

    await dispatchQuoteDeliveryByPhone("01012345678");

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-kakao" } })
    );
  });

  // 다른 고객의 견적서가 나가는 것이 최악이다 — 번호가 다르면 절대 매칭하지 않는다.
  it("번호가 다르면 매칭하지 않는다", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "d-other", user: { phone: "010-9999-8888" } },
    ]);

    const result = await dispatchQuoteDeliveryByPhone("+821012345678");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("정규화 불가능한 입력은 조회 없이 not_found", async () => {
    const result = await dispatchQuoteDeliveryByPhone("abc");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  // 같은 고객의 대기 건이 여럿이면 방금 요청한 것(최신)만 보낸다.
  // 후보 조회가 createdAt desc 이므로 첫 매칭이 곧 최신이다.
  it("같은 번호의 대기 건이 여럿이면 최신 건을 보낸다", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "d-new", user: { phone: "010-1234-5678" } },
      { id: "d-old", user: { phone: "010-1234-5678" } },
    ]);

    await dispatchQuoteDeliveryByPhone("01012345678");

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-new" } })
    );
  });

  it("대기 건 후보는 AWAITING_MESSAGE·최근 30일로 한정한다", async () => {
    mocks.findMany.mockResolvedValue([]);

    await dispatchQuoteDeliveryByPhone("01012345678");

    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "AWAITING_MESSAGE",
          createdAt: { gte: expect.any(Date) },
        }),
        orderBy: { createdAt: "desc" },
      })
    );
  });
});

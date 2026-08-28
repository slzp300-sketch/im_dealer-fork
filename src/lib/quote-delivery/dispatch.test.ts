import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    quoteDelivery: { findFirst: mocks.findFirst, findUnique: mocks.findUnique },
  },
}));

import { dispatchQuoteDeliveryByPhone } from "./dispatch";

// 매칭 판정만 검증한다. findUnique 가 not_found 를 돌려주게 두면 실제 발송
// (savedQuote 조회·이미지·적재)까지 내려가지 않는다.
beforeEach(() => {
  vi.clearAllMocks();
  mocks.userFindMany.mockResolvedValue([]);
  mocks.findFirst.mockResolvedValue(null);
  mocks.findUnique.mockResolvedValue(null);
});

describe("dispatchQuoteDeliveryByPhone", () => {
  // User.phone 은 가입 경로에 따라 "010-…" 와 "+82 10-…" 가 섞여 있다.
  // 저장 형식 변형을 전부 조건에 넣어 DB 에서 걷는다.
  it("저장 형식이 달라도 같은 번호면 매칭한다", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u-1" }]);
    mocks.findFirst.mockResolvedValue({ id: "d-domestic" });

    await dispatchQuoteDeliveryByPhone("+821012345678");

    // 같은 번호의 알려진 저장 형식을 전부 조건에 넣는다.
    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: {
            in: expect.arrayContaining([
              "+821012345678",
              "01012345678",
              "010-1234-5678",
              "+82 10-1234-5678",
            ]),
          },
        },
      })
    );
    // 매칭된 건으로 발송 경로에 진입했는지 — findUnique(id) 호출로 확인한다.
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-domestic" } })
    );
  });

  it("카카오 원본 형식(+82 10-…)도 매칭한다", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u-1" }]);
    mocks.findFirst.mockResolvedValue({ id: "d-kakao" });

    await dispatchQuoteDeliveryByPhone("01012345678");

    expect(mocks.userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          phone: {
            in: expect.arrayContaining(["+82 10-1234-5678"]),
          },
        },
      })
    );
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-kakao" } })
    );
  });

  // 다른 고객의 견적서가 나가는 것이 최악이다 — 번호가 다르면 절대 매칭하지 않는다.
  it("번호가 다르면 매칭하지 않는다", async () => {
    const result = await dispatchQuoteDeliveryByPhone("+821012345678");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("정규화 불가능한 입력은 조회 없이 not_found", async () => {
    const result = await dispatchQuoteDeliveryByPhone("abc");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it("회원은 매칭됐지만 대기 건이 없으면 not_found", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u-1" }]);

    const result = await dispatchQuoteDeliveryByPhone("01012345678");

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  // 같은 고객의 대기 건이 여럿이면 방금 요청한 것(최신)만 보낸다.
  // 최신 판정은 DB orderBy 에 맡긴다.
  it("대기 건 조회는 회원 id 로 한정하고 최신순으로 하나만 본다", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u-1" }, { id: "u-2" }]);
    mocks.findFirst.mockResolvedValue({ id: "d-new" });

    await dispatchQuoteDeliveryByPhone("01012345678");

    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: { in: ["u-1", "u-2"] },
          status: "AWAITING_MESSAGE",
          createdAt: { gte: expect.any(Date) },
        },
        orderBy: { createdAt: "desc" },
      })
    );
    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "d-new" } })
    );
  });

  // 후보 상한(take)이 없어야 대기 건이 늘어도 조용히 빠지는 일이 없다.
  it("대기 건 조회에 상한 take 를 두지 않는다", async () => {
    mocks.userFindMany.mockResolvedValue([{ id: "u-1" }]);

    await dispatchQuoteDeliveryByPhone("01012345678");

    const args = mocks.findFirst.mock.calls[0][0];
    expect(args).not.toHaveProperty("take");
  });
});

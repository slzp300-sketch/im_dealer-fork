import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("../prisma", () => ({
  prisma: {
    alimtalkMessage: {
      groupBy: mocks.groupBy,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
    },
  },
}));

import { getAlimtalkQueueStatus } from "./alimtalk-queue";

function groupRow(status: string, count: number) {
  return { status, _count: { _all: count } };
}

describe("getAlimtalkQueueStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findFirst.mockResolvedValue(null);
    mocks.findMany.mockResolvedValue([]);
  });

  it("존재하지 않는 상태는 0으로 채워 5개 상태 카운트를 반환한다", async () => {
    mocks.groupBy.mockResolvedValue([groupRow("SENT", 57), groupRow("FAILED", 4)]);

    const status = await getAlimtalkQueueStatus();

    expect(status.counts).toEqual({
      PENDING: 0,
      SENDING: 0,
      ACCEPTED: 0,
      SENT: 57,
      FAILED: 4,
    });
  });

  it("FAILED 최신 목록 조회에서 recipient/message 를 select 하지 않는다 (PII)", async () => {
    mocks.groupBy.mockResolvedValue([]);

    await getAlimtalkQueueStatus();

    const select = mocks.findMany.mock.calls[0][0].select as Record<string, unknown>;
    expect(Object.keys(select)).not.toContain("recipient");
    expect(Object.keys(select)).not.toContain("message");
    // 3015(템플릿 없음) 는 이 값 없이는 화면만 보고 원인을 못 잡는다.
    expect(Object.keys(select)).toContain("templateCode");
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ status: "FAILED" });
  });

  it("실패 목록의 failedAt 은 resultAt 우선, 없으면 updatedAt 으로 ISO 직렬화한다", async () => {
    mocks.groupBy.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([
      {
        id: "alim-1",
        templateKey: "QUOTE_DELIVERED",
        templateCode: "imdealer_quote_delivered",
        refType: "quote",
        refId: "ck8qz1x2y3w4v5",
        failReason: "3019 톡 유저 아님",
        resultCode: "3019",
        attempts: 3,
        createdAt: new Date("2026-08-19T08:55:00.000Z"),
        resultAt: new Date("2026-08-19T08:57:00.000Z"),
        updatedAt: new Date("2026-08-19T08:57:30.000Z"),
      },
      {
        id: "alim-2",
        templateKey: "REVIEW_REQUEST",
        templateCode: "imdealer_review_request",
        refType: null,
        refId: null,
        failReason: null,
        resultCode: "3020",
        attempts: 1,
        createdAt: new Date("2026-08-19T08:40:00.000Z"),
        resultAt: null,
        updatedAt: new Date("2026-08-19T08:41:00.000Z"),
      },
    ]);

    const status = await getAlimtalkQueueStatus();

    expect(status.recentFailures[0]).toMatchObject({
      id: "alim-1",
      templateCode: "imdealer_quote_delivered",
      failedAt: "2026-08-19T08:57:00.000Z",
      createdAt: "2026-08-19T08:55:00.000Z",
    });
    expect(status.recentFailures[1]).toMatchObject({
      id: "alim-2",
      failedAt: "2026-08-19T08:41:00.000Z",
      refType: null,
    });
  });

  it("가장 오래된 PENDING 생성 시각을 ISO 로 돌려준다", async () => {
    mocks.groupBy.mockResolvedValue([groupRow("PENDING", 3)]);
    mocks.findFirst.mockResolvedValue({
      createdAt: new Date("2026-08-19T08:18:00.000Z"),
    });

    const status = await getAlimtalkQueueStatus();

    expect(status.oldestPendingAt).toBe("2026-08-19T08:18:00.000Z");
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" },
      })
    );
  });
});

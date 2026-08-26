import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorker: vi.fn(),
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/worker-auth", () => ({ requireWorker: mocks.requireWorker }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    alimtalkMessage: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  },
}));

vi.mock("@/lib/pii", () => ({ decryptString: (v: string) => v }));

import { POST } from "./route";

function claimRequest(token = "relay-secret") {
  return new NextRequest("http://localhost/api/worker/alimtalk/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: "{}",
  });
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    status: "PENDING",
    templateCode: "imdealer_quote_delivered",
    recipient: "01012345678",
    message: "[아임딜러] 견적서 도착 안내",
    buttons: [{ name: "채널 추가", type: "AC" }],
    price: null,
    attempts: 0,
    ...overrides,
  };
}

describe("POST /api/worker/alimtalk/claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireWorker.mockImplementation((request: NextRequest) =>
      request.headers.get("authorization") === "Bearer relay-secret"
        ? { error: null }
        : { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
    );
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  // 견적서 본문에 월 납입금이 찍히므로 릴레이가 price/currencyType 을 실을 수 있어야 한다.
  it("금액이 있는 메시지는 price 를 함께 넘긴다", async () => {
    mocks.findMany.mockResolvedValue([candidate({ price: 763500 })]);

    const body = await (await POST(claimRequest())).json();

    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].price).toBe(763500);
  });

  // 금액이 없는 템플릿(후기·가입완료)에 price 를 실으면 등록 내용과 어긋난다.
  it("금액이 없으면 price 키 자체를 넘기지 않는다", async () => {
    mocks.findMany.mockResolvedValue([candidate({ price: null })]);

    const body = await (await POST(claimRequest())).json();

    expect(body.messages[0]).not.toHaveProperty("price");
  });
});

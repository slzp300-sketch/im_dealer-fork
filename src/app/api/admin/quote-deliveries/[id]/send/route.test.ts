import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminLike: vi.fn(),
  dispatch: vi.fn(),
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/require-admin", () => ({ requireAdminLike: mocks.requireAdminLike }));
vi.mock("@/lib/audit", () => ({ logAdminAction: mocks.logAdminAction }));
vi.mock("@/lib/quote-delivery/dispatch", () => ({
  dispatchQuoteDeliveryById: mocks.dispatch,
}));

import { POST } from "./route";

const params = Promise.resolve({ id: "delivery-1" });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminLike.mockResolvedValue({
    admin: { id: "admin-1", email: "admin@imdealer.co.kr" },
    error: null,
  });
  mocks.dispatch.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
  mocks.logAdminAction.mockResolvedValue(undefined);
});

describe("POST /api/admin/quote-deliveries/:id/send", () => {
  it("관리자가 아니면 발송하지 않는다", async () => {
    mocks.requireAdminLike.mockResolvedValue({
      admin: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await POST(new Request("http://localhost"), { params });

    expect(res.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("대기 중인 견적서를 발송하고 감사 로그를 남긴다", async () => {
    const res = await POST(new Request("http://localhost"), { params });

    expect(res.status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledWith("delivery-1");
    expect(mocks.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "QUOTE_DELIVERY_MANUAL_SEND", targetId: "delivery-1" })
    );
  });

  // 상담사가 왜 안 나갔는지 알 수 있어야 한다 — 이미 나갔는지, 견적이 사라졌는지.
  it("발송할 수 없는 상태면 사유를 돌려준다", async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, reason: "already_sent" });

    const res = await POST(new Request("http://localhost"), { params });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "이미 발송된 견적서입니다." });
    expect(mocks.logAdminAction).not.toHaveBeenCalled();
  });
});

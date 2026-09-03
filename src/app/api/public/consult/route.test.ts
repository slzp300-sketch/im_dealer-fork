import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveUser: vi.fn(),
  sendConsultRequestAlimtalk: vi.fn(),
  checkRateLimit: vi.fn(async (): Promise<NextResponse | null> => null),
}));

vi.mock("@/lib/require-user", () => ({ getActiveUser: mocks.getActiveUser }));
vi.mock("@/lib/consult-request-alimtalk", () => ({
  sendConsultRequestAlimtalk: mocks.sendConsultRequestAlimtalk,
}));
vi.mock("@/lib/rate-limit", () => ({
  consultRequestRateLimit: {},
  checkRateLimit: mocks.checkRateLimit,
}));

import { POST } from "./route";
import { consultRequestRateLimit } from "@/lib/rate-limit";

function req(body: unknown) {
  return new NextRequest("http://localhost/api/public/consult", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/public/consult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveUser.mockResolvedValue(null); // 기본: 비회원
    mocks.sendConsultRequestAlimtalk.mockResolvedValue({ ok: true });
    mocks.checkRateLimit.mockResolvedValue(null);
  });

  it("비회원: 유효 번호 + 동의 → 발송하고 200, source 를 라벨로 매핑", async () => {
    const res = await POST(req({ phone: "010-1234-5678", consent: true, source: "event" }));

    expect(res.status).toBe(200);
    expect(mocks.sendConsultRequestAlimtalk).toHaveBeenCalledWith({
      phone: "010-1234-5678",
      userId: undefined,
      source: "이벤트상담",
    });
  });

  it("알 수 없는 source 는 기본 라벨로 접는다(임의 주입 방지)", async () => {
    await POST(req({ phone: "010-1234-5678", consent: true, source: "hax<script>" }));
    expect(mocks.sendConsultRequestAlimtalk).toHaveBeenCalledWith(
      expect.objectContaining({ source: "상담신청" }),
    );
  });

  it("비회원: 동의가 없으면 400 이고 발송하지 않는다", async () => {
    const res = await POST(req({ phone: "010-1234-5678", source: "event" }));
    expect(res.status).toBe(400);
    expect(mocks.sendConsultRequestAlimtalk).not.toHaveBeenCalled();
  });

  it("비회원: 번호가 유효하지 않으면 400", async () => {
    const res = await POST(req({ phone: "01812345678", consent: true }));
    expect(res.status).toBe(400);
    expect(mocks.sendConsultRequestAlimtalk).not.toHaveBeenCalled();
  });

  it("회원: 세션의 번호를 쓰고 body 번호는 무시한다", async () => {
    mocks.getActiveUser.mockResolvedValue({ id: "u-1", phone: "010-9999-8888" });

    const res = await POST(req({ phone: "010-1111-2222", consent: false, source: "car-detail" }));

    expect(res.status).toBe(200);
    expect(mocks.sendConsultRequestAlimtalk).toHaveBeenCalledWith({
      phone: "010-9999-8888",
      userId: "u-1",
      source: "차량상세",
    });
  });

  it("checkRateLimit 이 429 를 반환하면 그대로 429 로 막고 발송하지 않는다", async () => {
    mocks.checkRateLimit.mockResolvedValue(
      NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 }),
    );
    const request = req({ phone: "010-1234-5678", consent: true });

    const res = await POST(request);

    expect(res.status).toBe(429);
    expect(mocks.sendConsultRequestAlimtalk).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      request,
      consultRequestRateLimit,
      "+821012345678",
    );
  });

  it("checkRateLimit 이 null 이면 통과하고 발송한다", async () => {
    mocks.checkRateLimit.mockResolvedValue(null);
    const request = req({ phone: "010-1234-5678", consent: true });

    const res = await POST(request);

    expect(res.status).toBe(200);
    expect(mocks.sendConsultRequestAlimtalk).toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      request,
      consultRequestRateLimit,
      "+821012345678",
    );
  });

  it("템플릿 미승인(no_template_code)이면 503", async () => {
    mocks.sendConsultRequestAlimtalk.mockResolvedValue({ ok: false, reason: "no_template_code" });
    const res = await POST(req({ phone: "010-1234-5678", consent: true }));
    expect(res.status).toBe(503);
  });

  it("발송단 invalid_phone 이면 400", async () => {
    mocks.sendConsultRequestAlimtalk.mockResolvedValue({ ok: false, reason: "invalid_phone" });
    const res = await POST(req({ phone: "010-1234-5678", consent: true }));
    expect(res.status).toBe(400);
  });
});

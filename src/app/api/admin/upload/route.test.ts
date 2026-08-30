import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRoleAtLeast: vi.fn(),
  checkRateLimit: vi.fn(),
  uploadAdminFile: vi.fn(),
  logAdminAction: vi.fn(),
}));

vi.mock("@/lib/require-admin", () => ({
  requireRoleAtLeast: mocks.requireRoleAtLeast,
}));

vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { limit: vi.fn() },
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/supabase/storage", () => ({
  ADMIN_UPLOAD_ALLOWED_MIME: new Set(["image/png"]),
  ADMIN_UPLOAD_CATEGORIES: ["vehicles"],
  ADMIN_UPLOAD_MAX_SIZE: 5 * 1024 * 1024,
  uploadAdminFile: mocks.uploadAdminFile,
}));

vi.mock("@/lib/audit", () => ({
  logAdminAction: mocks.logAdminAction,
}));

function request(): NextRequest {
  return new NextRequest("https://imdealer.co.kr/api/admin/upload", {
    method: "POST",
    body: new FormData(),
  });
}

describe("POST /api/admin/upload — 라우트 레벨 rate limit (proxy 게이트 제거 후 단일 방어선)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRoleAtLeast.mockResolvedValue({
      admin: { id: "admin-1", role: "staff" },
      error: null,
    });
    mocks.checkRateLimit.mockResolvedValue(null);
  });

  it("strict limiter가 429를 반환하면 그대로 429로 차단한다", async () => {
    mocks.checkRateLimit.mockResolvedValue(
      NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 })
    );
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "admin-upload"
    );
    expect(mocks.uploadAdminFile).not.toHaveBeenCalled();
  });

  it("인증 실패 시 rate limit을 호출하지 않는다 — 비인증 폭주가 Redis 쿼터를 소모하면 안 된다", async () => {
    mocks.requireRoleAtLeast.mockResolvedValue({
      admin: null,
      error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }),
    });
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
  });

  it("limiter 통과 시 기존 검증 흐름으로 진행한다 (파일 미첨부 400)", async () => {
    const { POST } = await import("./route");

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.checkRateLimit).toHaveBeenCalled();
  });
});

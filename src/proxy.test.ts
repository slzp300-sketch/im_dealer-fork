import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTrustedClientIp: vi.fn(),
  apiLimit: vi.fn(),
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  prismaFindUnique: vi.fn(),
  getVehicleImageE2EAdmin: vi.fn(),
}));

vi.mock("@/lib/client-ip", () => ({
  getTrustedClientIp: mocks.getTrustedClientIp,
}));

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: mocks.apiLimit },
  strictRateLimit: { limit: mocks.apiLimit },
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: mocks.prismaFindUnique } },
}));

vi.mock("@/lib/vehicle-images/e2e-admin-session", () => ({
  VEHICLE_IMAGE_E2E_ADMIN_COOKIE: "vehicle_image_e2e_admin",
  getVehicleImageE2EAdmin: mocks.getVehicleImageE2EAdmin,
}));

function request(pathname: string, hostname = "imdealer.com"): NextRequest {
  return new NextRequest(`https://${hostname}${pathname}`, {
    method: "GET",
    headers: { host: hostname },
  });
}

describe("proxy — rate limit은 라우트 레벨로 이관 (Upstash 쿼터 절감)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
    mocks.getTrustedClientIp.mockReturnValue(null);
    mocks.apiLimit.mockResolvedValue({
      success: true,
      limit: 40,
      remaining: 39,
      reset: Date.now() + 10_000,
    });
    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.getVehicleImageE2EAdmin.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("일반 API 경로에서 limiter를 호출하지 않는다 — 요청당 Redis 커맨드 소모 금지", async () => {
    const { default: middleware } = await import("./proxy");

    const response = await middleware(request("/api/quote/save"));

    expect(response.status).toBe(200);
    expect(mocks.apiLimit).not.toHaveBeenCalled();
    expect(mocks.getTrustedClientIp).not.toHaveBeenCalled();
  });

  it("구 strict 경로(추천·견적이미지·업로드)도 proxy에선 미호출 — 라우트 레벨 체크로 단일화", async () => {
    const { default: middleware } = await import("./proxy");

    await middleware(request("/api/recommend"));
    await middleware(request("/api/quote/image"));
    await middleware(request("/api/admin/upload"));

    expect(mocks.apiLimit).not.toHaveBeenCalled();
  });
});

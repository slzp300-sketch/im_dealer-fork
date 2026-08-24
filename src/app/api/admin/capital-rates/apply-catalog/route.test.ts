import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  mappingFindMany: vi.fn(),
  catalogGroupBy: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("@/lib/require-admin", () => ({
  requireRoleAtLeast: async () => ({
    admin: { id: "admin-1", email: "admin@example.com" },
    error: null,
  }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    capitalTrimMapping: { findMany: mocks.mappingFindMany },
    capitalCatalogTrim: { groupBy: mocks.catalogGroupBy },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/audit", () => ({ logAdminAction: mocks.audit }));
vi.mock("@/lib/revalidate", () => ({ revalidatePublicVehicleSurfaces: mocks.revalidate }));

import { POST } from "./route";

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/admin/capital-rates/apply-catalog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE_RATES = {
  "36_10000": 800000, "36_20000": 820000, "36_30000": 840000,
  "48_10000": 700000, "48_20000": 720000, "48_30000": 740000,
  "60_10000": 600000, "60_20000": 620000, "60_30000": 640000,
};

function mapping(trimId: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    trimId,
    externalLabel: `카탈로그 ${trimId}`,
    catalogTrim: {
      vehiclePrice: 45_000_000,
      baseRates: BASE_RATES,
      depositRate36_10000: null,
      prepayRate36_10000: null,
      trimName: "프리미엄",
      modelYear: "2027",
      mdelCd: "M1",
      warnings: null,
      weekOf: new Date("2026-07-19"),
      modelCd: "MDL-A",
      ...over,
    },
  };
}

const body = {
  financeCompanyId: "fc-1",
  productType: "장기렌트",
  weekOf: "2026-08-24",
  trimIds: ["t1", "t2"],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.transaction.mockImplementation(async () => ["sheet-1", "sheet-2"]);
});

describe("apply-catalog 지난 수집분 가드", () => {
  it("같은 브랜드의 다른 모델만 재수집돼도 이 모델 행은 차단하지 않는다 (모델 단위 비교)", async () => {
    mocks.mappingFindMany.mockResolvedValue([mapping("t1"), mapping("t2")]);
    // 다른 모델(MDL-B)은 오늘 재수집, 이 모델(MDL-A)의 최신은 그대로 7/19
    mocks.catalogGroupBy.mockResolvedValue([
      { modelCd: "MDL-A", _max: { weekOf: new Date("2026-07-19") } },
      { modelCd: "MDL-B", _max: { weekOf: new Date("2026-08-24") } },
    ]);

    const res = await POST(request(body));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.applied).toBe(2);
  });

  it("같은 모델 최신 수집에 빠진 잔존 행은 여전히 차단한다", async () => {
    mocks.mappingFindMany.mockResolvedValue([
      mapping("t1", { weekOf: new Date("2026-07-19") }),
      mapping("t2", { weekOf: new Date("2026-08-24") }),
    ]);
    mocks.catalogGroupBy.mockResolvedValue([
      { modelCd: "MDL-A", _max: { weekOf: new Date("2026-08-24") } },
    ]);

    const res = await POST(request(body));
    const d = await res.json();
    expect(res.status).toBe(200);
    const blocked = d.statuses.find((s: { trimId: string }) => s.trimId === "t1");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("지난 수집분");
    expect(d.statuses.find((s: { trimId: string }) => s.trimId === "t2").ok).toBe(true);
  });
});

describe("apply-catalog dryRun", () => {
  it("dryRun 은 시트를 쓰지 않고 트림별 판정만 돌려준다", async () => {
    mocks.mappingFindMany.mockResolvedValue([mapping("t1")]);
    mocks.catalogGroupBy.mockResolvedValue([
      { modelCd: "MDL-A", _max: { weekOf: new Date("2026-07-19") } },
    ]);

    const res = await POST(request({ ...body, trimIds: ["t1", "t2"], dryRun: true }));
    const d = await res.json();
    expect(res.status).toBe(200);
    expect(d.dryRun).toBe(true);
    expect(d.applicable).toBe(1);
    expect(d.statuses).toHaveLength(2);
    expect(d.statuses.find((s: { trimId: string }) => s.trimId === "t2").reason).toBe("매핑 없음");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("전부 차단이면 400 과 함께 사유 목록을 돌려준다", async () => {
    mocks.mappingFindMany.mockResolvedValue([]);
    mocks.catalogGroupBy.mockResolvedValue([]);

    const res = await POST(request(body));
    const d = await res.json();
    expect(res.status).toBe(400);
    expect(d.error).toContain("반영할 수 있는 트림이 없습니다");
    expect(d.statuses).toHaveLength(2);
  });
});

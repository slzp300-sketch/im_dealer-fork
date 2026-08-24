import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRoleAtLeast } from "@/lib/require-admin";
import { logAdminAction } from "@/lib/audit";
import { catalogMappingUpsertSchema } from "@/lib/validations/admin";

const catalogTrimSelect = {
  id: true, brandName: true, modelName: true, mdelCd: true, trimName: true,
  modelYear: true, vehiclePrice: true, baseRates: true, weekOf: true, scrapedAt: true,
} as const;

// GET /api/admin/capital-catalog/mappings?financeCompanyId=&vehicleId=&productType=
// 차량의 트림들 + 매핑 상태 + 매핑된 카탈로그 행 + "새 연식 후보" 플래그.
export async function GET(request: NextRequest) {
  const { error } = await requireRoleAtLeast("admin");
  if (error) return error;

  try {
    const sp = new URL(request.url).searchParams;
    const financeCompanyId = sp.get("financeCompanyId");
    const vehicleId = sp.get("vehicleId");
    const productType = sp.get("productType") ?? "장기렌트";
    const db = prisma;

    // 브랜드 요약 모드 — 차량 칩에 매핑 현황(매핑 m/트림 t)을 표시하기 위한 집계
    const summaryBrand = sp.get("summaryBrand");
    if (financeCompanyId && summaryBrand) {
      const vehiclesOfBrand = await db.vehicle.findMany({
        where: { brand: summaryBrand },
        select: { id: true, trims: { where: { lineupId: { not: null } }, select: { id: true } } },
      });
      const trimToVehicle = new Map<string, string>();
      for (const v of vehiclesOfBrand) for (const t of v.trims) trimToVehicle.set(t.id, v.id);
      const mapped = await db.capitalTrimMapping.findMany({
        where: { financeCompanyId, productType, trimId: { in: Array.from(trimToVehicle.keys()) } },
        select: { trimId: true },
      });
      const mappedByVehicle = new Map<string, number>();
      for (const m of mapped) {
        const vid = trimToVehicle.get(m.trimId);
        if (vid) mappedByVehicle.set(vid, (mappedByVehicle.get(vid) ?? 0) + 1);
      }
      return NextResponse.json({
        success: true,
        summary: vehiclesOfBrand.map((v) => ({
          vehicleId: v.id,
          total: v.trims.length,
          mapped: mappedByVehicle.get(v.id) ?? 0,
        })),
      });
    }

    if (!financeCompanyId || !vehicleId) {
      return NextResponse.json({ error: "financeCompanyId/vehicleId가 필요합니다." }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: {
        id: true, name: true, brand: true,
        trims: {
          where: { lineupId: { not: null } },
          select: { id: true, name: true, price: true, discountPrice: true, lineup: { select: { name: true } } },
        },
      },
    });
    if (!vehicle) return NextResponse.json({ error: "없는 차량" }, { status: 404 });

    const trimIds = vehicle.trims.map((t) => t.id);
    const mappings = await db.capitalTrimMapping.findMany({
      where: { financeCompanyId, productType, trimId: { in: trimIds } },
      include: { catalogTrim: { select: catalogTrimSelect } },
    });
    const byTrim = new Map(mappings.map((mapping) => [mapping.trimId, mapping] as const));

    const rows = await Promise.all(
      vehicle.trims.map(async (t) => {
        const m = byTrim.get(t.id);
        let newerYearAvailable = false;
        if (m?.catalogTrim?.modelYear) {
          // 같은 모델에서 더 최신 연식 행이 생겼는지 — 자동 교체 없이 배지로 재확인 유도
          const newer = await db.capitalCatalogTrim.findFirst({
            where: {
              financeCompanyId, productType,
              modelCd: (await db.capitalCatalogTrim.findUnique({ where: { id: m.catalogTrimId }, select: { modelCd: true } }))?.modelCd,
              modelYear: { gt: m.catalogTrim.modelYear },
            },
            select: { id: true },
          });
          newerYearAvailable = !!newer;
        }
        return {
          trimId: t.id,
          trimName: `${t.lineup?.name ?? ""} ${t.name}`.trim(),
          price: t.discountPrice ?? t.price,
          mapping: m
            ? {
                id: m.id, source: m.source, confidence: m.confidence,
                externalLabel: m.externalLabel, catalogTrim: m.catalogTrim, newerYearAvailable,
              }
            : null,
        };
      })
    );

    return NextResponse.json({ success: true, vehicle: { id: vehicle.id, name: vehicle.name, brand: vehicle.brand }, trims: rows });
  } catch (e) {
    console.error("[catalog mappings GET]", e);
    return NextResponse.json({ error: "조회 실패" }, { status: 500 });
  }
}

// POST /api/admin/capital-catalog/mappings — 매핑 upsert (자동 제안 채택 또는 수동 선택)
export async function POST(request: NextRequest) {
  const { admin: session, error } = await requireRoleAtLeast("admin");
  if (error) return error;

  try {
    const input = catalogMappingUpsertSchema.parse(await request.json());
    const db = prisma;

    const catalogTrim = await db.capitalCatalogTrim.findUnique({
      where: { id: input.catalogTrimId },
      select: { financeCompanyId: true, mdelCd: true, trimName: true, modelYear: true },
    });
    if (!catalogTrim || catalogTrim.financeCompanyId !== input.financeCompanyId) {
      return NextResponse.json({ error: "카탈로그 항목이 없거나 캐피탈사가 다릅니다." }, { status: 400 });
    }

    const externalLabel = `${catalogTrim.trimName}${catalogTrim.modelYear ? ` [${catalogTrim.modelYear}]` : ""}`;
    const data = {
      catalogTrimId: input.catalogTrimId,
      source: input.source,
      confidence: input.confidence ?? null,
      externalMdelCd: catalogTrim.mdelCd,
      externalLabel,
      createdById: session.id,
    };
    const mapping = await db.capitalTrimMapping.upsert({
      where: {
        financeCompanyId_trimId_productType: {
          financeCompanyId: input.financeCompanyId,
          trimId: input.trimId,
          productType: input.productType,
        },
      },
      create: { financeCompanyId: input.financeCompanyId, trimId: input.trimId, productType: input.productType, ...data },
      update: data,
    });

    await logAdminAction({
      request,
      actor: session,
      action: "CATALOG_MAPPING_UPSERT",
      resource: "CapitalTrimMapping",
      targetId: mapping.id,
      meta: { financeCompanyId: input.financeCompanyId, trimId: input.trimId, mdelCd: catalogTrim.mdelCd, source: input.source },
    });

    return NextResponse.json({ success: true, mappingId: mapping.id });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "입력값이 올바르지 않습니다.", details: e.flatten() }, { status: 400 });
    }
    console.error("[catalog mappings POST]", e);
    return NextResponse.json({ error: "저장 실패" }, { status: 500 });
  }
}

// DELETE /api/admin/capital-catalog/mappings?id= — 매핑 해제
export async function DELETE(request: NextRequest) {
  const { admin: session, error } = await requireRoleAtLeast("admin");
  if (error) return error;

  try {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    const db = prisma;

    const mapping = await db.capitalTrimMapping.findUnique({ where: { id } });
    if (!mapping) return NextResponse.json({ error: "없는 매핑" }, { status: 404 });
    await db.capitalTrimMapping.delete({ where: { id } });

    await logAdminAction({
      request,
      actor: session,
      action: "CATALOG_MAPPING_DELETE",
      resource: "CapitalTrimMapping",
      targetId: id,
      meta: { financeCompanyId: mapping.financeCompanyId, trimId: mapping.trimId },
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[catalog mappings DELETE]", e);
    return NextResponse.json({ error: "삭제 실패" }, { status: 500 });
  }
}

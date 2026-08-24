import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireRoleAtLeast } from "@/lib/require-admin";
import { logAdminAction } from "@/lib/audit";
import { revalidatePublicVehicleSurfaces } from "@/lib/revalidate";
import { applyCatalogSchema } from "@/lib/validations/admin";
import { calcRateMatrix, RATE_KEYS } from "@/lib/quote-calculator";
import { buildCollectedRateData } from "@/lib/scraper/rate-matrices";
import { WARN_MODEL_FALLBACK } from "@/lib/scraper/excel-capitals";
import type { RateSheetRaw } from "@/types/admin";

// 수십 트림 일괄 반영이 기본 함수 시간(10초)을 넘지 않도록 여유를 둔다
export const maxDuration = 60;

type CatalogSheetData = Omit<
  Prisma.CapitalRateSheetUncheckedCreateInput,
  "financeCompanyId" | "trimId" | "productType" | "weekOf"
>;

// POST /api/admin/capital-rates/apply-catalog — 매핑된 카탈로그 트림을 정확값 시트로 반영.
// 시트는 min=max=카탈로그 차량가(트림별 정확값, 보간 없음 — quote-calculator 의 min==max 가드가 처리).
export async function POST(request: NextRequest) {
  const { admin: session, error } = await requireRoleAtLeast("admin");
  if (error) return error;

  try {
    const input = applyCatalogSchema.parse(await request.json());
    const db = prisma;
    const weekDate = new Date(input.weekOf);

    // 매핑 → 카탈로그 행 로드
    const mappings = await db.capitalTrimMapping.findMany({
      where: {
        financeCompanyId: input.financeCompanyId,
        productType: input.productType,
        trimId: { in: input.trimIds },
      },
      include: {
        catalogTrim: {
          select: {
            vehiclePrice: true,
            baseRates: true,
            depositRate36_10000: true,
            prepayRate36_10000: true,
            trimName: true,
            modelYear: true,
            mdelCd: true,
            warnings: true,
            weekOf: true,
            modelCd: true,
          },
        },
      },
    });
    const byTrim = new Map(mappings.map((mapping) => [mapping.trimId, mapping] as const));

    // 모델별 최신 수집주 — 같은 모델 재수집에서 빠진(단종·명칭 변경 추정) 잔존 행의 옛 요율 반영 차단용.
    // 브랜드 기준이 아닌 모델 기준: 수집이 차량(모델) 단위 부분 수집이라, 같은 브랜드의
    // 다른 차량만 재수집해도 아직 재수집 안 된 모델 전체가 과차단되는 문제를 막는다.
    const modelMax = await db.capitalCatalogTrim.groupBy({
      by: ["modelCd"],
      where: { financeCompanyId: input.financeCompanyId, productType: input.productType },
      _max: { weekOf: true },
    });
    const latestByModel = new Map(modelMax.map((b) => [b.modelCd, b._max.weekOf]));

    const warnings: string[] = [];
    // 트림별 판정 — dryRun 미리보기와 실제 반영이 같은 기준을 쓴다
    const statuses: { trimId: string; label: string; ok: boolean; reason?: string }[] = [];
    const targets: { trimId: string; sheetData: CatalogSheetData }[] = [];
    for (const trimId of input.trimIds) {
      const m = byTrim.get(trimId);
      if (!m) {
        warnings.push(`${trimId}: 매핑 없음 — 건너뜀`);
        statuses.push({ trimId, label: trimId, ok: false, reason: "매핑 없음" });
        continue;
      }
      const cat = m.catalogTrim;
      const baseRates = cat.baseRates as RateSheetRaw;
      const hasAny = RATE_KEYS.some((k) => (baseRates?.[k] ?? 0) > 0);
      if (!hasAny || !(cat.vehiclePrice > 0)) {
        warnings.push(`${m.externalLabel}: 수집값 없음(9칸 전부 0) — 건너뜀`);
        statuses.push({ trimId, label: m.externalLabel, ok: false, reason: "수집값 없음(9칸 전부 0)" });
        continue;
      }
      // 트림 미확정 폴백 가격(base 트림 근사)으로 산출된 행은 부정확한 견적이 되므로 반영 차단
      const catWarnings = Array.isArray(cat.warnings) ? (cat.warnings as string[]) : [];
      if (catWarnings.includes(WARN_MODEL_FALLBACK)) {
        warnings.push(`${m.externalLabel}: 가격이 트림 미확정 폴백값(모델만 일치) — 트림 매칭 확인 후 재업로드 필요, 건너뜀`);
        statuses.push({ trimId, label: m.externalLabel, ok: false, reason: "가격이 트림 미확정 폴백값 — 트림 매칭 확인 후 재업로드 필요" });
        continue;
      }
      // 같은 모델 최신 수집에 빠진 잔존 행(단종·명칭 변경 추정)의 옛 요율은 반영하지 않음
      const modelLatest = latestByModel.get(cat.modelCd);
      if (modelLatest && cat.weekOf < modelLatest) {
        warnings.push(`${m.externalLabel}: 지난 수집분(${cat.weekOf.toISOString().slice(0, 10)}) — 같은 모델 최신 수집에 없는 행이라 건너뜀, 매핑 재확인 필요`);
        statuses.push({
          trimId,
          label: m.externalLabel,
          ok: false,
          reason: `지난 수집분(${cat.weekOf.toISOString().slice(0, 10)}) — 같은 모델 최신 수집에 없음, 매핑 재확인 필요`,
        });
        continue;
      }
      const collected = buildCollectedRateData(
        baseRates,
        cat.vehiclePrice,
        cat.depositRate36_10000,
        cat.prepayRate36_10000
      );
      if (collected.depositDiscountRate > 0) {
        warnings.push(`${m.externalLabel}: 보증금 적용 견적이 기준 견적보다 높아 건너뜀`);
        statuses.push({ trimId, label: m.externalLabel, ok: false, reason: "보증금 적용 견적이 기준 견적보다 높음" });
        continue;
      }
      statuses.push({ trimId, label: m.externalLabel, ok: true });
      const rateMatrix = calcRateMatrix(collected.baseRates, cat.vehiclePrice);
      targets.push({
        trimId,
        sheetData: {
          // 정확값: min=max (보간 없음)
          minVehiclePrice: cat.vehiclePrice,
          maxVehiclePrice: cat.vehiclePrice,
          minBaseRates: collected.baseRates,
          maxBaseRates: collected.baseRates,
          minDepositRates: collected.depositRates,
          minPrepayRates: collected.prepayRates,
          maxDepositRates: collected.depositRates,
          maxPrepayRates: collected.prepayRates,
          minRateMatrix: rateMatrix,
          maxRateMatrix: rateMatrix,
          depositDiscountRate: collected.depositDiscountRate,
          prepayAdjustRate: collected.prepayAdjustRate,
          isActive: true,
          memo: `카탈로그 반영: ${cat.trimName}${cat.modelYear ? ` [${cat.modelYear}]` : ""} (${cat.mdelCd})`,
        },
      });
    }

    // 미리보기: 쓰기 없이 트림별 판정만 반환
    if (input.dryRun) {
      return NextResponse.json({ dryRun: true, statuses, applicable: targets.length });
    }

    if (targets.length === 0) {
      return NextResponse.json({ error: "반영할 수 있는 트림이 없습니다.", warnings, statuses }, { status: 400 });
    }

    // 기존 POST /api/admin/capital-rates 와 동일한 주간 전환 규약 (weekOf 충돌 시 update, 아니면 활성 전환 후 create).
    // 트림별 순차 왕복이면 수십 트림 일괄 반영이 서버리스 시간 제한에 걸리므로 집합 연산으로 묶는다.
    const sheetIds = await prisma.$transaction(async (tx) => {
      const targetTrimIds = targets.map((t) => t.trimId);
      const existing = await tx.capitalRateSheet.findMany({
        where: {
          financeCompanyId: input.financeCompanyId,
          productType: input.productType,
          weekOf: weekDate,
          trimId: { in: targetTrimIds },
        },
        select: { id: true, trimId: true },
      });
      const existingByTrim = new Map(existing.map((e) => [e.trimId, e.id]));
      const toCreate = targets.filter((t) => !existingByTrim.has(t.trimId));
      const toUpdate = targets.filter((t) => existingByTrim.has(t.trimId));

      if (toCreate.length > 0) {
        // 주간 전환: 새로 만드는 트림들의 기존 활성 시트를 한 번에 이력으로 전환
        await tx.capitalRateSheet.updateMany({
          where: {
            financeCompanyId: input.financeCompanyId,
            productType: input.productType,
            trimId: { in: toCreate.map((t) => t.trimId) },
            isActive: true,
          },
          data: { isActive: false },
        });
        await tx.capitalRateSheet.createMany({
          data: toCreate.map(({ trimId, sheetData }) => ({
            financeCompanyId: input.financeCompanyId,
            trimId,
            productType: input.productType,
            weekOf: weekDate,
            ...sheetData,
          })),
        });
      }
      // 같은 주 재반영은 값만 갱신 — 트림별 값이 달라 개별 update (보통 소수)
      for (const { trimId, sheetData } of toUpdate) {
        await tx.capitalRateSheet.update({
          where: { id: existingByTrim.get(trimId)! },
          data: sheetData,
        });
      }
      const saved = await tx.capitalRateSheet.findMany({
        where: {
          financeCompanyId: input.financeCompanyId,
          productType: input.productType,
          weekOf: weekDate,
          trimId: { in: targetTrimIds },
        },
        select: { id: true },
      });
      return saved.map((s) => s.id);
    });

    await logAdminAction({
      request,
      actor: session,
      action: "RATE_SHEET_APPLY_CATALOG",
      resource: "CapitalRateSheet",
      meta: {
        financeCompanyId: input.financeCompanyId,
        productType: input.productType,
        weekOf: input.weekOf,
        applied: sheetIds.length,
        skipped: warnings.length,
      },
    });
    revalidatePublicVehicleSurfaces();

    return NextResponse.json({ success: true, applied: sheetIds.length, sheetIds, warnings, statuses });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "입력값이 올바르지 않습니다.", details: e.flatten() }, { status: 400 });
    }
    console.error("[apply-catalog POST]", e);
    return NextResponse.json({ error: "반영 실패" }, { status: 500 });
  }
}

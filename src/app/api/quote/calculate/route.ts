import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveUser } from "@/lib/require-user";
import { hashIp, getClientIp } from "@/lib/ip-hash";
import {
  calculateMultiFinanceQuote,
  type RateConfigData,
  type CalcInput,
} from "@/lib/quote-calculator";
import type { FinanceQuoteResult, QuoteScenarioDetails } from "@/types/quote";
import type { RateSheetRaw } from "@/types/admin";
import {
  INHERITANCE_SURCHARGE_RATE,
  PUBLIC_RESULT_INITIAL_COST,
  RANK_SURCHARGE_RATES,
  SCENARIO_CONDITIONS,
} from "@/constants/quote-defaults";
import { gateQuoteScenariosForGuest } from "@/lib/member-gate";
import { EXTRA_OPTIONS_PRICE_MAX } from "@/app/api/quote/save/request-schema";
import { PUBLIC_TRIM_WHERE } from "@/lib/vehicle-visibility-policy";
import { upsertQuoteCalcLogs } from "@/lib/quote-calc-log";

const calculateSchema = z.object({
  sessionId: z.string().min(1).max(64).optional(),
  vehicleSlug: z.string().min(1),
  trimId: z.string().optional(),
  selectedOptionIds: z.array(z.string()).optional(),
  extraOptionsPrice: z.number().int().min(0).max(EXTRA_OPTIONS_PRICE_MAX).optional(),
  contractMonths: z.number().int().refine((v) => [36, 48, 60].includes(v)),
  annualMileage: z.number().int().refine((v) => [10000, 20000, 30000].includes(v)),
  contractType: z.enum(["인수형", "반납형"]),
  customerType: z.enum(["individual", "self_employed", "corporate", "nonprofit"]).default("individual"),
  productType: z.enum(["장기렌트", "리스"]).default("장기렌트"),
  exteriorColorId: z.string().nullable().optional(),
  interiorColorId: z.string().nullable().optional(),
});

// ── POST /api/quote/calculate ────────────────────────────
// 독립 견적 계산 엔드포인트 (3개 시나리오 반환)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input = calculateSchema.parse(body);

    // 1) 차량 + 트림 조회
    const vehicle = await prisma.vehicle.findUnique({
      where: { slug: input.vehicleSlug },
      include: {
        trims: {
          where: PUBLIC_TRIM_WHERE,
          orderBy: { isDefault: "desc" },
          include: { options: { select: { id: true, name: true, price: true } } },
        },
        colors: {
          select: { id: true, kind: true, name: true, priceDelta: true },
        },
      },
    });

    if (!vehicle || !vehicle.isVisible) {
      return NextResponse.json(
        { error: "차량을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    const trim = input.trimId
      ? vehicle.trims.find((t) => t.id === input.trimId)
      : vehicle.trims.find((t) => t.isDefault) ?? vehicle.trims[0];

    if (!trim) {
      return NextResponse.json(
        { error: "트림을 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 옵션 가격 합산
    const selectedOptionIds = new Set(input.selectedOptionIds ?? []);
    const selectedOptions = trim.options
      .filter((o) => selectedOptionIds.has(o.id))
      .map((o) => ({ id: o.id, name: o.name, price: o.price }));
    const trimOptionsTotalPrice = selectedOptions.reduce((sum, o) => sum + o.price, 0);
    const optionsTotalPrice = trimOptionsTotalPrice + (input.extraOptionsPrice ?? 0);

    // 색상 priceDelta 합산 (벨리데이션 — kind 일치 확인)
    const exteriorColor = input.exteriorColorId
      ? vehicle.colors.find((c) => c.id === input.exteriorColorId && c.kind === "EXTERIOR")
      : null;
    const interiorColor = input.interiorColorId
      ? vehicle.colors.find((c) => c.id === input.interiorColorId && c.kind === "INTERIOR")
      : null;
    const colorDelta = (exteriorColor?.priceDelta ?? 0) + (interiorColor?.priceDelta ?? 0);

    // 할인가: discountPrice 있으면 회수율 계산용 차량가로 사용
    const effectiveTrimPrice = trim.discountPrice ?? trim.price;
    // 차량가(??)와 같은 기준으로 null 만 제외 — discountPrice=0 인 트림도 표기가 어긋나지 않게.
    const discountAmount = trim.discountPrice != null ? trim.price - trim.discountPrice : 0;
    const totalVehiclePrice = effectiveTrimPrice + optionsTotalPrice + colorDelta;

    const userAgent = request.headers.get("user-agent") ?? undefined;
    // sessionId 는 견적 페이지에서만 실린다. 없는 요청까지 익명 키로 적재하면
    // 요청마다 새 행이 무한 증식하므로(고유키 dedup 무력화) 로그를 남기지 않는다.
    const logSessionId = input.sessionId ?? null;
    const user = await getActiveUser();
    const calcLogBase = {
      userId: user?.supabaseId ?? null,
      vehicleId: vehicle.id,
      vehicleSlug: input.vehicleSlug,
      vehicleName: vehicle.name,
      vehicleBrand: vehicle.brand,
      trimId: trim.id,
      trimName: trim.name,
      trimPrice: trim.price,
      discountPrice: trim.discountPrice ?? null,
      optionIds: selectedOptions.map((option) => option.id),
      optionSnapshots: selectedOptions,
      extraOptionsPrice: input.extraOptionsPrice ?? 0,
      optionsTotalPrice,
      exteriorColorId: exteriorColor?.id ?? null,
      exteriorColorName: exteriorColor?.name ?? null,
      interiorColorId: interiorColor?.id ?? null,
      interiorColorName: interiorColor?.name ?? null,
      colorDelta,
      totalVehiclePrice,
      contractMonths: input.contractMonths,
      annualMileage: input.annualMileage,
      contractType: input.contractType,
      productType: input.productType,
      customerType: input.customerType,
      deviceType: /Mobile|Android|iPhone/i.test(userAgent ?? "") ? "mobile" : "desktop",
      referrer: request.headers.get("referer") ?? undefined,
      userAgent,
      ipHash: hashIp(getClientIp(request)),
    };

    // 2) 회수율 데이터 + 순위 가산 동시 조회
    const [rateSheets, rankSurcharges] = await Promise.all([
      prisma.capitalRateSheet.findMany({
        where: {
          trimId: trim.id,
          productType: input.productType,
          isActive: true,
          financeCompany: { isActive: true },
        },
        include: { financeCompany: true },
      }),
      prisma.rankSurchargeConfig.findMany({ orderBy: { rank: "asc" } }),
    ]);

    // 자동 견적 불가 공통 분기 — 회수율 시트가 없거나, 시트는 있어도 요청 조건의
    // 회수율이 전부 무효해 계산 결과가 비는 경우. 월납 0원을 정상 견적처럼 내려주지 않는다.
    const respondConsultationRequired = async () => {
      if (logSessionId) {
        try {
          await upsertQuoteCalcLogs([
            {
              ...calcLogBase,
              sessionId: logSessionId,
              // 별도 상담에는 표시 조건이 없다 — 결과 화면 기본 노출과 같은
              // 공개 조건(선납 30%)으로 기록해 무보증 행 왜곡을 막는다.
              depositRate: PUBLIC_RESULT_INITIAL_COST.depositRate,
              prepayRate: PUBLIC_RESULT_INITIAL_COST.prepayRate,
              resultMonthly: 0,
              bestFinanceCompany: "",
              scenarioType: "standard",
              pricingStatus: "CONSULTATION_REQUIRED",
              rangeExceeded: false,
            },
          ]);
        } catch (err) {
          console.error("[QuoteCalcLog] 별도 상담 로그 저장 실패:", err);
          Sentry.captureException(err, {
            tags: { route: "quote/calculate", op: "consultation-log" },
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          vehicleSlug: input.vehicleSlug,
          vehicleName: vehicle.name,
          vehicleBrand: vehicle.brand,
          trimId: trim.id,
          trimName: trim.name,
          trimPrice: trim.price,
          discountPrice: trim.discountPrice ?? null,
          discountAmount,
          optionsTotalPrice,
          colorDelta,
          totalVehiclePrice,
          contractMonths: input.contractMonths,
          annualMileage: input.annualMileage,
          contractType: input.contractType,
          customerType: input.customerType,
          scenarios: {} as Record<string, never>,
          requiresConsultation: true,
        },
      });
    };

    if (rateSheets.length === 0) {
      // 회수율 시트가 1건도 없는 경우.
      return respondConsultationRequired();
    }

    // 3) 데이터 매핑
    const configs: RateConfigData[] = rateSheets.map((rs) => ({
      financeCompanyId: rs.financeCompanyId,
      financeCompanyName: rs.financeCompany.name,
      financeSurchargeRate: rs.financeCompany.surchargeRate,
      minVehiclePrice: rs.minVehiclePrice,
      maxVehiclePrice: rs.maxVehiclePrice,
      minRateMatrix: rs.minRateMatrix as RateSheetRaw,
      maxRateMatrix: rs.maxRateMatrix as RateSheetRaw,
      depositDiscountRate: rs.depositDiscountRate,
      prepayAdjustRate: rs.prepayAdjustRate,
    }));

    const rankRates = rankSurcharges.length > 0
      ? rankSurcharges.map((r) => r.rate)
      : [...RANK_SURCHARGE_RATES];

    // 4) 3개 시나리오별 계산
    let standardUnavailable = false;
    const scenarioKeys = ["conservative", "standard", "aggressive"] as const;
    const scenarios: Record<string, {
      monthlyPayment: number;
      depositAmount: number;
      prepayAmount: number;
      contractMonths: number;
      annualMileage: number;
      contractType: string;
      bestFinanceCompany: string;
      purchaseSurcharge: number;
      breakdown: FinanceQuoteResult["breakdown"] | null;
      surcharges: FinanceQuoteResult["surcharges"] | null;
      rangeExceeded: boolean;
      allFinanceResults: {
        financeCompanyName: string;
        rank: number;
        monthlyPayment: number;
        baseMonthly: number;
        surcharges: FinanceQuoteResult["surcharges"];
      }[];
    }> = {};

    for (const key of scenarioKeys) {
      const { depositRate, prepayRate } = SCENARIO_CONDITIONS[key];

      const calcInput: CalcInput = {
        vehiclePrice: totalVehiclePrice,
        contractMonths: input.contractMonths,
        annualMileage: input.annualMileage,
        depositRate,
        prepayRate,
        vehicleSurchargeRate: vehicle.surchargeRate,
        rankSurchargeRates: rankRates,
        rateConfigs: configs,
      };

      const results = calculateMultiFinanceQuote(calcInput);

      if (results.length === 0) {
        if (key === "standard") standardUnavailable = true;
        scenarios[key] = {
          monthlyPayment: 0,
          depositAmount: 0,
          prepayAmount: 0,
          contractMonths: input.contractMonths,
          annualMileage: input.annualMileage,
          contractType: input.contractType,
          bestFinanceCompany: "",
          purchaseSurcharge: 0,
          breakdown: null,
          surcharges: null,
          rangeExceeded: false,
          allFinanceResults: [],
        };
        continue;
      }

      const isPurchase = input.contractType === "인수형";
      const best = results[0];
      const purchaseSurcharge = isPurchase ? Math.round(best.monthlyPayment * INHERITANCE_SURCHARGE_RATE) : 0;
      const monthlyPayment = best.monthlyPayment + purchaseSurcharge;

      scenarios[key] = {
        monthlyPayment,
        depositAmount: best.breakdown.depositAmount,
        prepayAmount: best.breakdown.prepayAmount,
        contractMonths: input.contractMonths,
        annualMileage: input.annualMileage,
        contractType: input.contractType,
        bestFinanceCompany: best.financeCompanyName,
        purchaseSurcharge,
        breakdown: best.breakdown,
        surcharges: best.surcharges,
        // 최저가 금융사의 회수율 시트 범위 초과 여부.
        // 모든 금융사가 같은 차량가 입력을 받으므로 어느 best 기준이든 같다.
        rangeExceeded: best.rangeExceeded,
        allFinanceResults: results.map((r) => {
          const rPurchase = isPurchase ? Math.round(r.monthlyPayment * INHERITANCE_SURCHARGE_RATE) : 0;
          return {
            financeCompanyName: r.financeCompanyName,
            rank: r.rank,
            monthlyPayment: r.monthlyPayment + rPurchase,
            baseMonthly: r.baseMonthly,
            surcharges: r.surcharges,
          };
        }),
      };
    }

    if (standardUnavailable) {
      // 시트는 있어도 요청한 개월·주행 조건의 회수율이 전부 무효 → 월납 0원 노출 방지.
      return respondConsultationRequired();
    }

    // ── 견적 로그 저장 ──
    // 비회원 응답은 aggressive(선납 30%)만 금액이 공개된다 — 로그도 그 행만 남겨
    // 어드민 "견적만 확인"에 화면에 없던 무보증·보증금 행이 쌓이지 않게 한다.
    if (logSessionId) {
      try {
        await upsertQuoteCalcLogs(
          Object.entries(scenarios)
            .filter(([scenarioType]) => user || scenarioType === "aggressive")
            .map(([scenarioType, sc]) => ({
              ...calcLogBase,
              sessionId: logSessionId,
              depositRate:
                SCENARIO_CONDITIONS[scenarioType as keyof typeof SCENARIO_CONDITIONS]
                  ?.depositRate ?? 0,
              prepayRate:
                SCENARIO_CONDITIONS[scenarioType as keyof typeof SCENARIO_CONDITIONS]
                  ?.prepayRate ?? 0,
              resultMonthly: sc.monthlyPayment,
              bestFinanceCompany: sc.bestFinanceCompany,
              scenarioType,
              pricingStatus: "CALCULATED" as const,
              rangeExceeded: sc.rangeExceeded,
            }))
        );
      } catch (err) {
        console.error("[QuoteCalcLog] 저장 실패:", err);
        Sentry.captureException(err, { tags: { route: "quote/calculate", op: "log" } });
      }
    }

    // 비회원: 선납 30%(aggressive)만 금액을 남기고 무보증·보증금은 잠근다.
    // 표시 API(/api/vehicles/[slug]/quote)와 동일한 정책. 기간·거리는 요청값 그대로.
    const gatedScenarios = user
      ? scenarios
      : gateQuoteScenariosForGuest(scenarios as unknown as QuoteScenarioDetails);

    return NextResponse.json({
      success: true,
      data: {
        vehicleSlug: input.vehicleSlug,
        vehicleName: vehicle.name,
        vehicleBrand: vehicle.brand,
        trimId: trim.id,
        trimName: trim.name,
        trimPrice: trim.price,
        discountPrice: trim.discountPrice ?? null,
        discountAmount,
        optionsTotalPrice,
        colorDelta,
        totalVehiclePrice,
        contractMonths: input.contractMonths,
        annualMileage: input.annualMileage,
        contractType: input.contractType,
        customerType: input.customerType,
        scenarios: gatedScenarios,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다.", details: error.flatten() },
        { status: 400 }
      );
    }
    console.error("[POST /api/quote/calculate]", error);
    Sentry.captureException(error, { tags: { route: "quote/calculate" } });
    return NextResponse.json(
      { error: "견적 계산 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

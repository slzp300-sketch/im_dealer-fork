import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getActiveUser } from "@/lib/require-user";
import {
  calculateMultiFinanceQuote,
  type RateConfigData,
  type CalcInput,
} from "@/lib/quote-calculator";
import type { RateSheetRaw } from "@/types/admin";
import type { FinanceQuoteResult, QuoteScenarioDetails } from "@/types/quote";
import {
  INHERITANCE_SURCHARGE_RATE,
  PUBLIC_RESULT_INITIAL_COST,
  RANK_SURCHARGE_RATES,
  SCENARIO_CONDITIONS,
} from "@/constants/quote-defaults";
import { normalizeSelectedOptions } from "@/lib/option-rules";
import {
  gateQuoteScenariosForGuest,
  isPublicQuoteResultRates,
} from "@/lib/member-gate";
import { hashIp, getClientIp } from "@/lib/ip-hash";
import { EXTRA_OPTIONS_PRICE_MAX } from "@/app/api/quote/save/request-schema";
import { PUBLIC_TRIM_WHERE } from "@/lib/vehicle-visibility-policy";
import { upsertQuoteCalcLog } from "@/lib/quote-calc-log";

const quoteSchema = z
  .object({
    // 견적 페이지에서만 전달 — 있으면 조회/계산 로그를 세션 기준으로 적재한다(비교 기능 등은 미전달).
    sessionId: z.string().min(1).max(64).optional(),
    trimId: z.string().optional(),
    selectedOptionIds: z.array(z.string()).optional(),
    extraOptionsPrice: z.number().int().min(0).max(EXTRA_OPTIONS_PRICE_MAX).optional(),
    contractMonths: z.number().int().refine((v) => [36, 48, 60].includes(v)),
    annualMileage: z.number().int().refine((v) => [10000, 20000, 30000].includes(v)),
    contractType: z.enum(["인수형", "반납형"]),
    productType: z.enum(["장기렌트", "리스"]).default("장기렌트"),
    customerType: z
      .enum(["individual", "self_employed", "corporate", "nonprofit"])
      .default("individual"),
    customDepositRate: z.number().int().min(0).max(30).optional(),
    customPrepayRate: z.number().int().min(0).max(30).optional(),
    exteriorColorId: z.string().nullable().optional(),
    interiorColorId: z.string().nullable().optional(),
  })
  .refine(
    (input) =>
      (input.customDepositRate ?? 0) === 0 || (input.customPrepayRate ?? 0) === 0,
    { message: "보증금과 선납금은 동시에 적용할 수 없습니다." }
  );

// ─── POST /api/vehicles/:slug/quote ─────────────────────
// 조건별 3개 시나리오 견적 (전체 파이프라인: 선형보간 → 보증금/선납금 → 순위가산 + 차량가산 + 금융사가산)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const body = await request.json();
    const input = quoteSchema.parse(body);

    // 0) 회원 여부 확인 — 견적 결과에서 비회원에게 금액을 남기는 공개 조건은
    //    선납 30%(deposit 0 / prepay 30)뿐이다. 그 외 커스텀 비율과
    //    무보증·보증금 시나리오는 응답 JSON 에 금액을 담지 않는다(보안 경계).
    const user = await getActiveUser();
    const isMember = !!user;

    // 커스텀 보증/선납 비율이 실제 계산(standard 슬롯)에 적용되는 요청인지.
    // 회원은 자유, 비회원은 공개 조건(선납 30%)일 때만 적용된다.
    const hasCustomRates =
      input.customDepositRate !== undefined || input.customPrepayRate !== undefined;
    const guestCustomIsPublic =
      !isMember &&
      hasCustomRates &&
      isPublicQuoteResultRates({
        depositRate: input.customDepositRate ?? 0,
        prepayRate: input.customPrepayRate ?? 0,
      });
    const appliesCustomRates = hasCustomRates && (isMember || guestCustomIsPublic);
    // 계산 로그(어드민 "견적만 확인")에 남길 초기비용 — 사용자가 화면에서 실제
    // 보는 조건. 커스텀 재계산은 그 비율, 그 외 첫 화면은 회원·비회원 공통
    // 기본값인 선납 30%다. 내부 계산용 무보증(0/0)을 기록하면 비회원이 무보증
    // 견적을 본 것처럼 어드민에 표시되는 왜곡이 생긴다.
    const loggedRates = appliesCustomRates
      ? {
          depositRate: input.customDepositRate ?? 0,
          prepayRate: input.customPrepayRate ?? 0,
        }
      : PUBLIC_RESULT_INITIAL_COST;

    // 1) 차량 + 트림 조회
    const vehicle = await prisma.vehicle.findUnique({
      where: { slug },
      include: {
        trims: {
          where: PUBLIC_TRIM_WHERE,
          orderBy: { isDefault: "desc" },
          include: {
            options: { select: { id: true, name: true, price: true } },
            rules: {
              select: {
                ruleType: true,
                sourceOptionId: true,
                targetOptionId: true,
              },
            },
          },
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

    if (!input.trimId && vehicle.trims.length > 0) {
      return NextResponse.json(
        { error: "트림을 선택해 주세요." },
        { status: 400 }
      );
    }

    const trim = input.trimId
      ? vehicle.trims.find((t) => t.id === input.trimId)
      : undefined;

    if (input.trimId && !trim) {
      return NextResponse.json(
        { error: "선택한 트림이 차량에 속하지 않습니다." },
        { status: 400 }
      );
    }

    if (!trim) {
      if (input.sessionId) {
        const userAgent = request.headers.get("user-agent") ?? undefined;
        const exteriorColor = input.exteriorColorId
          ? vehicle.colors.find(
              (color) => color.id === input.exteriorColorId && color.kind === "EXTERIOR"
            )
          : null;
        const interiorColor = input.interiorColorId
          ? vehicle.colors.find(
              (color) => color.id === input.interiorColorId && color.kind === "INTERIOR"
            )
          : null;
        const colorDelta =
          (exteriorColor?.priceDelta ?? 0) + (interiorColor?.priceDelta ?? 0);

        try {
          await upsertQuoteCalcLog({
            sessionId: input.sessionId,
            userId: user?.supabaseId ?? null,
            vehicleId: vehicle.id,
            vehicleSlug: slug,
            vehicleName: vehicle.name,
            vehicleBrand: vehicle.brand,
            trimId: null,
            trimName: null,
            trimPrice: vehicle.basePrice,
            discountPrice: null,
            optionIds: [],
            optionSnapshots: [],
            extraOptionsPrice: input.extraOptionsPrice ?? 0,
            optionsTotalPrice: input.extraOptionsPrice ?? 0,
            exteriorColorId: exteriorColor?.id ?? null,
            exteriorColorName: exteriorColor?.name ?? null,
            interiorColorId: interiorColor?.id ?? null,
            interiorColorName: interiorColor?.name ?? null,
            colorDelta,
            totalVehiclePrice:
              vehicle.basePrice + (input.extraOptionsPrice ?? 0) + colorDelta,
            contractMonths: input.contractMonths,
            annualMileage: input.annualMileage,
            depositRate: loggedRates.depositRate,
            prepayRate: loggedRates.prepayRate,
            contractType: input.contractType,
            productType: input.productType,
            customerType: input.customerType,
            resultMonthly: 0,
            bestFinanceCompany: "",
            scenarioType: "standard",
            pricingStatus: "CONSULTATION_REQUIRED",
            rangeExceeded: false,
            deviceType: /Mobile|Android|iPhone/i.test(userAgent ?? "")
              ? "mobile"
              : "desktop",
            referrer: request.headers.get("referer") ?? undefined,
            userAgent,
            ipHash: hashIp(getClientIp(request)),
          });
        } catch (err) {
          console.error("[vehicles/:slug/quote] 트림 미등록 로그 적재 실패:", err);
          Sentry.captureException(err, {
            tags: { route: "vehicles/:slug/quote", op: "missing-trim-log" },
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          vehicleSlug: slug,
          trimId: "",
          trimName: "",
          trimPrice: vehicle.basePrice,
          discountPrice: null,
          discountAmount: 0,
          optionsTotalPrice: 0,
          colorDelta: 0,
          totalVehiclePrice: vehicle.basePrice,
          contractMonths: input.contractMonths,
          annualMileage: input.annualMileage,
          contractType: input.contractType,
          customerType: input.customerType,
          scenarios: {} as Record<string, never>,
          requiresConsultation: true,
        },
      });
    }

    // 선택된 옵션을 규칙(REQUIRED/INCLUDED/CONFLICT) 기준으로 검증·정규화
    const { normalized: selectedOptionIds, conflicts } = normalizeSelectedOptions(
      input.selectedOptionIds ?? [],
      trim.rules,
    );

    if (conflicts.length > 0) {
      const optMap = new Map(trim.options.map((o) => [o.id, o.name]));
      const pairs = conflicts
        .map(
          (c) =>
            `${optMap.get(c.sourceOptionId) ?? c.sourceOptionId} ↔ ${optMap.get(c.targetOptionId) ?? c.targetOptionId}`,
        )
        .join(", ");
      return NextResponse.json(
        { error: `함께 선택할 수 없는 옵션 조합입니다: ${pairs}` },
        { status: 400 },
      );
    }

    // 정규화된 옵션 집합으로 가격 합산 (REQUIRED/INCLUDED 자동 포함분 반영)
    const selectedOptions = trim.options
      .filter((o) => selectedOptionIds.has(o.id))
      .map((o) => ({ id: o.id, name: o.name, price: o.price }));
    const trimOptionsTotalPrice = selectedOptions.reduce((sum, o) => sum + o.price, 0);
    const optionsTotalPrice = trimOptionsTotalPrice + (input.extraOptionsPrice ?? 0);

    // 색상 priceDelta (kind 일치 검증)
    const exteriorColor = input.exteriorColorId
      ? vehicle.colors.find((c) => c.id === input.exteriorColorId && c.kind === "EXTERIOR")
      : null;
    const interiorColor = input.interiorColorId
      ? vehicle.colors.find((c) => c.id === input.interiorColorId && c.kind === "INTERIOR")
      : null;
    const colorDelta = (exteriorColor?.priceDelta ?? 0) + (interiorColor?.priceDelta ?? 0);

    // 할인가: discountPrice 있으면 그것을 차량가 기준으로 사용
    const effectiveTrimPrice = trim.discountPrice ?? trim.price;
    // 차량가(??)와 같은 기준으로 null 만 제외 — discountPrice=0 인 트림도 표기가 어긋나지 않게.
    const discountAmount = trim.discountPrice != null ? trim.price - trim.discountPrice : 0;
    const totalVehiclePrice = effectiveTrimPrice + optionsTotalPrice + colorDelta;
    const userAgent = request.headers.get("user-agent") ?? undefined;
    const calcLogBase = {
      userId: user?.supabaseId ?? null,
      vehicleId: vehicle.id,
      vehicleSlug: slug,
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

    // 2) 회수율 데이터 + 순위 가산 설정 동시 조회
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
    // 회수율이 전부 무효해 계산 결과가 비는 경우. 월납 0원을 정상 견적처럼
    // 내려주지 않고 "별도 상담 필요"로 안내한다. 차량/트림 메타는 그대로 반환.
    const respondConsultationRequired = async () => {
      if (input.sessionId) {
        try {
          await upsertQuoteCalcLog({
            sessionId: input.sessionId,
            ...calcLogBase,
            depositRate: loggedRates.depositRate,
            prepayRate: loggedRates.prepayRate,
            resultMonthly: 0,
            bestFinanceCompany: "",
            scenarioType: "standard",
            pricingStatus: "CONSULTATION_REQUIRED",
            rangeExceeded: false,
          });
        } catch (err) {
          console.error("[vehicles/:slug/quote] 별도 상담 로그 적재 실패:", err);
          Sentry.captureException(err, {
            tags: { route: "vehicles/:slug/quote", op: "consultation-log" },
          });
        }
      }

      return NextResponse.json({
        success: true,
        data: {
          vehicleSlug: slug,
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
      // 해당 트림(라인업)의 회수율 시트가 1건도 등록되지 않은 경우.
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

    // 순위 가산율: DB에 있으면 DB, 없으면 상수 fallback
    const rankRates = rankSurcharges.length > 0
      ? rankSurcharges.map((r) => r.rate)
      : [...RANK_SURCHARGE_RATES];

    // 4) 시나리오별 전체 파이프라인 실행
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
      let depositRate: number = SCENARIO_CONDITIONS[key].depositRate;
      let prepayRate: number  = SCENARIO_CONDITIONS[key].prepayRate;
      // 커스텀 보증/선납 비율: 회원은 자유. 비회원은 공개 조건(deposit 0 / prepay 30)만 적용.
      if (key === "standard" && (isMember || guestCustomIsPublic)) {
        if (input.customDepositRate !== undefined) depositRate = input.customDepositRate;
        if (input.customPrepayRate  !== undefined) prepayRate  = input.customPrepayRate;
      }

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
        // 해당 조건에서 계산 불가 → 기본값
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

      // 인수형: 잔존가치 상쇄를 위한 가산 (전체 금융사 동일 적용).
      // 다른 견적 경로(calculate/save/scenarios)와 같은 합산식 — best.monthlyPayment 는 이미
      // 반올림 정수라 [monthlyPayment == best + surcharge] 항등이 유지된다.
      const best = results[0];
      const purchaseSurcharge = input.contractType === "인수형"
        ? Math.round(best.monthlyPayment * INHERITANCE_SURCHARGE_RATE)
        : 0;
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
        rangeExceeded: best.rangeExceeded,
        allFinanceResults: results.map((r) => ({
          financeCompanyName: r.financeCompanyName,
          rank: r.rank,
          monthlyPayment:
            r.monthlyPayment +
            (input.contractType === "인수형"
              ? Math.round(r.monthlyPayment * INHERITANCE_SURCHARGE_RATE)
              : 0),
          baseMonthly: r.baseMonthly,
          surcharges: r.surcharges,
        })),
      };
    }

    if (standardUnavailable) {
      // 시트는 있어도 요청한 개월·주행 조건의 회수율이 전부 무효 → 월납 0원 노출 방지.
      return respondConsultationRequired();
    }

    // 비회원: 선납 30%(aggressive)만 공개. 무보증·보증금은 잠근다.
    // 커스텀 재계산이 공개 조건(0/30)이면 standard 슬롯 금액은 그대로 둔다.
    const gatedScenarios = isMember
      ? scenarios
      : gateQuoteScenariosForGuest(scenarios as unknown as QuoteScenarioDetails, {
          keepStandardUnlocked: guestCustomIsPublic,
        });

    // ── 로그 적재: 견적 조회(ExplorationLog) + 계산 로그(QuoteCalcLog) ──
    // sessionId 가 실린 경우(견적 페이지)만 기록. 세션×차량 기준 1건으로 dedup 하여
    // 슬라이더 재계산 등 반복 호출이 카운트를 부풀리지 않게 한다.
    if (input.sessionId) {
      const sessionId = input.sessionId;
      // 사용자가 실제 본 시나리오 — 커스텀 재계산은 standard 슬롯(그 비율로 계산됨),
      // 그 외 첫 화면은 기본 노출인 선납 30%(aggressive) 슬롯.
      const displayed = appliesCustomRates ? scenarios.standard : scenarios.aggressive;
      try {
        // QuoteCalcLog: 세션×차량×시나리오 고유키로 최신 조건/결과를 원자적으로 갱신.
        // scenarioType "standard"는 세션×차량 대표 행 키다 — 조건은 rates 필드가 진실.
        const calcData = {
          ...calcLogBase,
          depositRate: loggedRates.depositRate,
          prepayRate: loggedRates.prepayRate,
          resultMonthly: displayed?.monthlyPayment ?? 0,
          bestFinanceCompany: displayed?.bestFinanceCompany ?? "",
          scenarioType: "standard",
          pricingStatus: "CALCULATED" as const,
          rangeExceeded: displayed?.rangeExceeded ?? false,
        };
        await upsertQuoteCalcLog({ sessionId, ...calcData });

        // ExplorationLog(quote_start): 세션×차량 최초 1건만 — 대시보드/분석 "견적 조회" 소스.
        const existingView = await prisma.explorationLog.findFirst({
          where: { sessionId, vehicleId: vehicle.id, eventType: "quote_start" },
          select: { id: true },
        });
        if (!existingView) {
          await prisma.explorationLog.create({
            data: {
              sessionId,
              eventType: "quote_start",
              path: `/quote?vehicle=${slug}`,
              vehicleId: vehicle.id,
              metadata: {
                contractMonths: input.contractMonths,
                annualMileage: input.annualMileage,
              },
              userAgent,
              ipHash: calcLogBase.ipHash,
            },
          });
        }
      } catch (err) {
        // 로그 적재 실패는 견적 응답에 영향 주지 않는다.
        console.error("[vehicles/:slug/quote] 로그 적재 실패:", err);
        Sentry.captureException(err, {
          tags: { route: "vehicles/:slug/quote", op: "calculation-log" },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        vehicleSlug: slug,
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
    return NextResponse.json(
      { error: "견적 계산 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

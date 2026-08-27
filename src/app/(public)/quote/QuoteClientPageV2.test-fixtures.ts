import { vi } from "vitest";
import type { QuoteResponse, VehicleListItem } from "@/types/api";

export const vehicles = [{
  id: "vehicle-preparing",
  slug: "preparing-car",
  name: "준비중 차량",
  brand: "아임",
  category: "SUV",
  basePrice: 40_000_000,
  evSubsidyRange: null,
  thumbnailUrl: "",
  isPopular: false,
  description: null,
  displayOrder: 1,
  defaultTrim: {
    name: "프리미엄",
    price: 40_000_000,
    engineType: "가솔린",
    fuelEfficiency: null,
    specs: null,
  },
  monthlyFrom: 0,
  highlights: [],
  tags: [],
}] satisfies VehicleListItem[];

function quoteScenario(monthlyPayment: number, depositAmount: number, prepayAmount: number) {
  return {
    monthlyPayment,
    depositAmount,
    prepayAmount,
    contractMonths: 60,
    annualMileage: 20000,
    contractType: "반납형",
    bestFinanceCompany: "테스트캐피탈",
    purchaseSurcharge: 0,
    breakdown: null,
    surcharges: null,
    allFinanceResults: [],
  };
}

export function createUnlockedCalculatedQuoteResult(): QuoteResponse {
  return {
    vehicleSlug: "preparing-car",
    trimId: "trim-preparing",
    trimName: "프리미엄",
    trimPrice: 40_000_000,
    optionsTotalPrice: 0,
    colorDelta: 0,
    totalVehiclePrice: 40_000_000,
    contractMonths: 60,
    annualMileage: 20000,
    contractType: "반납형",
    customerType: "individual",
    scenarios: {
      conservative: quoteScenario(610_000, 8_000_000, 0),
      standard: quoteScenario(700_000, 0, 0),
      aggressive: quoteScenario(530_000, 0, 12_000_000),
    },
    requiresConsultation: false,
  };
}

function writeRestore(
  requiresConsultation: boolean,
  locked = false,
  firstEntry = false,
): void {
  const unlockedResult = createUnlockedCalculatedQuoteResult();
  window.localStorage.setItem(
    "quote_image_restore",
    JSON.stringify({
      schemaVersion: 1,
      vehicleSlug: "preparing-car",
      customerType: "individual",
      selectedLineup: null,
      selectedTrimName: requiresConsultation ? null : "프리미엄",
      selectedOptionIds: [],
      contractCategory: "장기렌트",
      conditions: {
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
      },
      customRates: firstEntry
        ? { depositRate: 0, prepayRate: 30 }
        : {
            depositRate: requiresConsultation || locked ? 0 : 10,
            prepayRate: 0,
          },
      costMode: requiresConsultation ? "none" : "initial",
      baseStandard: requiresConsultation ? null : quoteScenario(700_000, 0, 0),
      quoteResult: {
        vehicleSlug: "preparing-car",
        trimId: "trim-preparing",
        trimName: "프리미엄",
        trimPrice: 40_000_000,
        optionsTotalPrice: 0,
        colorDelta: 0,
        totalVehiclePrice: 40_000_000,
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
        customerType: "individual",
        scenarios: requiresConsultation
          ? {
              // 상담 필요 판정은 requiresConsultation 플래그가 담당한다. 시나리오가
              // 아예 없는 스냅샷은 T12 의 readQuoteImageRestore 검증에서 파손으로
              // 폐기되므로, 검증을 통과하는 형태로 만들어도 같은 화면이 그려진다.
              conservative: quoteScenario(0, 0, 0),
              standard: quoteScenario(0, 0, 0),
              aggressive: quoteScenario(0, 0, 0),
            }
          : locked
            ? {
                conservative: {
                  ...quoteScenario(0, 0, 0),
                  locked: true,
                },
                standard: {
                  ...quoteScenario(0, 0, 0),
                  locked: true,
                },
                aggressive: unlockedResult.scenarios.aggressive,
              }
            : firstEntry
              ? {
                  conservative: quoteScenario(610_000, 8_000_000, 0),
                  standard: quoteScenario(700_000, 0, 0),
                  aggressive: quoteScenario(530_000, 0, 12_000_000),
                }
              : {
                  conservative: quoteScenario(610_000, 8_000_000, 0),
                  standard: quoteScenario(650_000, 4_000_000, 0),
                  aggressive: quoteScenario(530_000, 0, 12_000_000),
                },
        requiresConsultation,
      },
    })
  );
}

export function writeConsultationRestore(): void {
  writeRestore(true);
}

/**
 * 모든 시나리오가 잠긴 채 복원되는 비회원 세션 — 표시할 공개 금액이 하나도 없다.
 * 구형 잠금(locked + monthlyPayment 0)과 신형 잠금(locked + monthlyPayment null)
 * 두 형태 모두 0만원 배너 없이 로그인 안내로 이어져야 한다.
 */
export function writeGuestAllLockedRestore(lockedMonthly: 0 | null): void {
  const lockedScenario = {
    ...quoteScenario(0, 0, 0),
    monthlyPayment: lockedMonthly,
    bestFinanceCompany: "",
    locked: true,
  };
  window.localStorage.setItem(
    "quote_image_restore",
    JSON.stringify({
      schemaVersion: 1,
      vehicleSlug: "preparing-car",
      customerType: "individual",
      selectedLineup: null,
      selectedTrimName: "프리미엄",
      selectedOptionIds: [],
      contractCategory: "장기렌트",
      conditions: {
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
      },
      customRates: { depositRate: 0, prepayRate: 30 },
      costMode: "initial",
      baseStandard: null,
      quoteResult: {
        vehicleSlug: "preparing-car",
        trimId: "trim-preparing",
        trimName: "프리미엄",
        trimPrice: 40_000_000,
        optionsTotalPrice: 0,
        colorDelta: 0,
        totalVehiclePrice: 40_000_000,
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
        customerType: "individual",
        scenarios: {
          conservative: lockedScenario,
          standard: lockedScenario,
          aggressive: lockedScenario,
        },
        requiresConsultation: false,
      },
    })
  );
}

export function writeCalculatedRestore(): void {
  writeRestore(false);
}

/**
 * 비회원 첫 화면(선납 30%)에서 로그인 게이트로 나간 직후의 실제 복원 상태 —
 * quoteResult 는 아직 비회원 게이트 응답(standard·conservative 잠금 + 공개 aggressive)이고,
 * baseStandard 도 게스트 세션이 저장한 그대로 **잠긴** standard 다.
 * 로그인 후 이 상태에서 없음(무보증)을 선택하는 재현 시나리오에 쓴다.
 */
export function writeGuestGatedFirstEntryRestore(): void {
  const lockedScenario = {
    ...quoteScenario(0, 0, 0),
    monthlyPayment: null,
    bestFinanceCompany: "",
    locked: true,
  };
  window.localStorage.setItem(
    "quote_image_restore",
    JSON.stringify({
      schemaVersion: 1,
      vehicleSlug: "preparing-car",
      customerType: "individual",
      selectedLineup: null,
      selectedTrimName: "프리미엄",
      selectedOptionIds: [],
      contractCategory: "장기렌트",
      conditions: {
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
      },
      customRates: { depositRate: 0, prepayRate: 30 },
      costMode: "initial",
      baseStandard: lockedScenario,
      quoteResult: {
        vehicleSlug: "preparing-car",
        trimId: "trim-preparing",
        trimName: "프리미엄",
        trimPrice: 40_000_000,
        optionsTotalPrice: 0,
        colorDelta: 0,
        totalVehiclePrice: 40_000_000,
        contractMonths: 60,
        annualMileage: 20000,
        contractType: "반납형",
        customerType: "individual",
        scenarios: {
          conservative: lockedScenario,
          standard: lockedScenario,
          aggressive: quoteScenario(530_000, 0, 12_000_000),
        },
        requiresConsultation: false,
      },
    })
  );
}

export function writeLockedCalculatedRestore(): void {
  writeRestore(false, true);
}

export function writeFirstEntryRestore(): void {
  writeRestore(false, false, true);
}

export function savedQuoteSuccessData(overrides: Record<string, unknown> = {}) {
  return {
    id: "saved-quote",
    sessionId: "session-1",
    requiresConsultation: false,
    monthlyPayment: 640_000,
    totalCost: 38_400_000,
    pricingStatus: "CALCULATED" as const,
    depositRate: 10,
    prepayRate: 0,
    depositAmount: 4_000_000,
    prepayAmount: 0,
    bestFinanceCompany: "저장캐피탈",
    ...overrides,
  };
}

export function createFetchMock(saveStatus = 200) {
  return vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(async (input) => {
    const url = input.toString();
    if (url.endsWith("/colors") || url.endsWith("/trims")) {
      return Response.json({ success: true, data: [] });
    }
    if (url.endsWith("/quote") && url !== "/api/quote/save") {
      return Response.json({ success: true, data: createUnlockedCalculatedQuoteResult() });
    }
    if (url === "/api/quote/save") {
      return Response.json(
        saveStatus === 200
          ? { success: true, data: savedQuoteSuccessData() }
          : { error: "save failed" },
        { status: saveStatus }
      );
    }
    // 기본값은 대기 모드가 꺼진 세계. 404 는 "이 기능을 쓰지 않는다"는 뜻이라
    // 견적 페이지가 기존 붙여넣기 흐름으로 이어간다.
    if (url === "/api/quote/deliver") {
      return Response.json({ error: "사용할 수 없는 기능입니다." }, { status: 404 });
    }
    return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
  });
}

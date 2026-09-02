"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Image from "next/image";
import { z } from "zod";
import {
  ChevronLeft,
  BriefcaseBusiness,
  Building2,
  User,
  Users,
  Check,
  ArrowRight,
  AlertCircle,
  BadgePercent,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useAuthUser } from "@/hooks/useAuthUser";
import { startKakaoLogin } from "@/lib/kakao/client-auth";
import { isKakaoSyncEnabled } from "@/lib/kakao/scopes";
import { cn } from "@/lib/utils";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { isSupabaseStorageUrl } from "@/lib/image-url";
import { sortLineups } from "@/lib/lineup-sort";
import { pickDefaultColor } from "@/lib/default-color";
import { productTypeLabel } from "@/constants/product-type";
import { TossPrice } from "@/components/ui/TossPrice";
import { ChannelTalkButton } from "@/components/quote/ChannelTalkButton";
import {
  hasQuoteResultDelivery,
  QuoteResultActions,
  QuoteResultDeliveryBar,
} from "@/components/quote/QuoteResultActions";
import {
  openChannelTalkWithQuote,
  trackQuoteDeliveryRequested,
  trackQuoteDeliverySent,
  type ChannelTalkQuoteContext,
} from "@/lib/channel-talk";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";
import { REQUEST_CODE_LABEL } from "@/lib/quote-delivery/request-code";
import { QuoteDeliveryGuideModal } from "@/components/quote/QuoteDeliveryGuideModal";
import { LoginBenefitsModal } from "@/components/quote/LoginBenefitsModal";
import { QuoteDeliveryLoginModal } from "@/components/quote/QuoteDeliveryLoginModal";
import { ComparisonSection } from "@/components/quote/ComparisonSection";
import { type ComparisonTrimData } from "@/components/quote/VehicleConfigPanel";
import { EvSubsidyNotice } from "@/components/quote/EvSubsidyNotice";
import {
  type CustomerType,
  isCustomerType,
} from "@/constants/customer-types";
import type { VehicleListItem, QuoteResponse } from "@/types/api";
import type { QuoteScenarioDetail } from "@/types/quote";
import {
  DEFAULT_RESULT_COST_MODE,
  DEFAULT_RESULT_CUSTOM_RATES,
  deriveQuoteScenarioType,
  isDisplayableQuoteScenario,
  resolveQuoteResultScenario,
} from "@/lib/quote-scenario-selection";
import { successfulCalculatedQuoteResponseSchema } from "@/lib/quote-response-schema";
import { trackQuoteRequestConversion } from "@/lib/google-ads";
import {
  applySavedQuoteAmountsToDisplay,
  quoteSaveLoginRedirect,
  savedQuoteResponseSchema,
} from "@/lib/saved-quote-client";
import type { VehicleColorPublic } from "@/components/quote/ColorSelector";
import {
  type LineupChoice,
  type TrimChoice,
} from "@/components/quote/LineupTrimPicker";
import {
  readQuoteImageRestore,
  saveQuoteImageRestore,
  type QuoteImageRestoreState,
} from "@/lib/quote-draft";
import { Step2ConditionV2, type TrimDataV2 } from "./Step2ConditionV2";
import { InitialCostPanelV2, type CostMode } from "./InitialCostPanelV2";
import {
  ApprovalPreviewV2,
  FinanceSectionV2,
  CostCheckpointV2,
} from "./QuoteInfoSectionsV2";
import {
  DEFAULT_PUBLIC_QUOTE_PRODUCT_TYPE,
  PUBLIC_CARD_QUOTE_CONDITION,
} from "@/constants/quote-defaults";
import { useTracking } from "@/lib/use-tracking";

// ─── 상수 ────────────────────────────────────────────────
const STEPS = ["고객 유형", "조건 설정", "견적 확인"] as const;

// 견적서 받기 로그인 게이트 → 로그인 후 복귀 시 요청 흐름을 이어가기 위한 URL 표식.
const DELIVERY_RESUME_PARAM = "deliver";

// 초기비용 재계산 실패 안내 — 화면 금액이 직전 조건 기준임을 분명히 한다.
const RECALCULATION_ERROR_MESSAGE =
  "새 조건으로 다시 계산하지 못했어요. 아래 금액은 직전 조건 기준이에요.";

// 추천 카드의 트림이 견적 목록에 없을 때 — 기본 트림으로 폴백하되 침묵하지 않는다.
const PREFILL_FALLBACK_MESSAGE =
  "추천하신 트림을 지금은 선택할 수 없어요. 기본 트림으로 먼저 보여드릴게요.";

function exclusivePrimaryRates(rates: {
  depositRate: number;
  prepayRate: number;
}): { depositRate: number; prepayRate: number } {
  if (rates.depositRate > 0 && rates.prepayRate > 0) {
    return { depositRate: 0, prepayRate: 0 };
  }
  return rates;
}

// 자동 재개가 재동의(409)를 요구받았을 때의 안내. 여기서 동의창으로 되돌아가면
// 복귀 → 자동 재개 → 409 → 동의창… 왕복이 무한 반복되므로 사용자 클릭을 기다린다.
const KAKAO_REAUTH_MANUAL_RETRY_MESSAGE =
  "카카오톡 전송 권한이 만료됐어요. 아래 「카카오톡으로 견적서 받기」를 다시 눌러 동의해 주세요.";

// 자동 재개 1회 예산의 소진 표식. OAuth 왕복은 페이지 전체 이동이라 useRef 가드가
// 회차마다 초기화된다 — 이동을 견디는 sessionStorage 에 남겨야 차단막이 된다.
const AUTO_DELIVERY_RESUME_SPENT_KEY = "imd_quote_auto_resume_spent";

/** 사용자가 직접 동의/로그인으로 나갔다 — 그 왕복 1회분 자동 재개를 허용한다. */
function grantAutoDeliveryResume(): void {
  try {
    window.sessionStorage.removeItem(AUTO_DELIVERY_RESUME_SPENT_KEY);
  } catch {
    // 저장소 접근 불가(프라이빗 모드 등) — 소비 로직이 기존 동작으로 폴백한다.
  }
}

/** 예산이 남아 있으면 소비하고 true. 이미 소진했으면 자동 재개를 막는다. */
function consumeAutoDeliveryResume(): boolean {
  try {
    if (window.sessionStorage.getItem(AUTO_DELIVERY_RESUME_SPENT_KEY) === "1") {
      return false;
    }
    window.sessionStorage.setItem(AUTO_DELIVERY_RESUME_SPENT_KEY, "1");
    return true;
  } catch {
    // 저장소를 못 쓰면 마운트당 1회(useRef) 보호만 남는다.
    return true;
  }
}

// 게이트 로그인 왕복 동안 견적 세션 ID 를 보관하는 localStorage 키.
// 복귀 마운트에서 같은 세션을 이어받아야 계산 로그(QuoteCalcLog) → 게이트 이벤트
// (ExplorationLog) → 전환(clickedApply)이 한 세션 기준으로 조인된다.
const DELIVERY_GATE_SESSION_KEY = "imd_delivery_gate_session";

// 결과(step 3) 전용 히스토리 항목. 시스템 뒤로가기가 차량 상세로 나가지 않게 한다.
const QUOTE_RESULT_HISTORY_KEY = "imdQuoteResult";

// 결과 카드 "타 업체 평균" 비교 표기 전용 가산율 — 실제 시장 데이터가 아니며,
// 견적 계산 로직(quote-calculator)과 무관한 표시 전용 값이다.
// 월 납입금 구간별로 달리해 차이가 항상 약 2~3만원 대에 머물도록 한다.
const COMPETITOR_MARKUP_TIERS: readonly [number, number][] = [
  [400_000, 0.065],
  [600_000, 0.05],
  [800_000, 0.035],
  [1_000_000, 0.03],
  [Number.POSITIVE_INFINITY, 0.025],
];

function competitorMarkupRate(monthlyPayment: number): number {
  const tier = COMPETITOR_MARKUP_TIERS.find(([maxMonthly]) => monthlyPayment < maxMonthly);
  return tier?.[1] ?? 0.025;
}

function isHistoryStateRecord(state: unknown): state is Record<string, unknown> {
  return typeof state === "object" && state !== null;
}

function hasQuoteResultHistoryState(state: unknown): boolean {
  return isHistoryStateRecord(state) && state[QUOTE_RESULT_HISTORY_KEY] === true;
}

function quoteResultHistoryState(state: unknown): Record<string, unknown> {
  return {
    ...(isHistoryStateRecord(state) ? state : {}),
    [QUOTE_RESULT_HISTORY_KEY]: true,
  };
}

function buildQuoteRestoreHref(vehicleSlug: string, customerType: CustomerType): string {
  const params = new URLSearchParams(window.location.search);
  params.set("vehicle", vehicleSlug);
  if (customerType) params.set("customerType", customerType);
  params.set("restore", "1");
  return `/quote?${params.toString()}`;
}

function syncQuoteResultHistory(vehicleSlug: string, customerType: CustomerType): void {
  const href = buildQuoteRestoreHref(vehicleSlug, customerType);
  const nextState = quoteResultHistoryState(window.history.state);
  if (hasQuoteResultHistoryState(window.history.state)) {
    window.history.replaceState(nextState, "", href);
    return;
  }
  window.history.pushState(nextState, "", href);
}

const apiErrorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
});

// 대기 모드 응답. requestCode 가 없으면 기존(수동 발송) 흐름으로 취급한다.
const quotePreparedSchema = z.object({
  data: z.object({ requestCode: z.string().min(1).nullish() }),
});

// 상담 필요 결과는 scenarios 가 빈 객체일 수 있어 옵셔널 접근으로 판별한다.
function hasLockedQuoteScenario(quote: QuoteResponse): boolean {
  return (
    quote.scenarios.conservative?.locked === true ||
    quote.scenarios.standard?.locked === true ||
    quote.scenarios.aggressive?.locked === true
  );
}

const CUSTOMER_TYPE_OPTIONS: {
  type: CustomerType;
  title: string;
  desc: string;
  icon: ReactNode;
}[] = [
  {
    type: "individual",
    title: "개인",
    desc: "개인 명의로 계약을 진행해요",
    icon: <User size={22} strokeWidth={1.8} />,
  },
  {
    type: "self_employed",
    title: "개인사업자",
    desc: "사업자등록 기준으로 서류를 확인해요",
    icon: <BriefcaseBusiness size={22} strokeWidth={1.8} />,
  },
  {
    type: "corporate",
    title: "법인",
    desc: "법인 사업자등록 기준으로 진행해요",
    icon: <Building2 size={22} strokeWidth={1.8} />,
  },
];

// ─── 트림/옵션 타입 (v1 계약 유지) ───────────────────────
interface TrimOption {
  id: string;
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  isAccessory: boolean;
  isDefault: boolean;
  badge: string | null;
}

interface TrimRule {
  id: string;
  ruleType: string;
  sourceOptionId: string;
  targetOptionId: string;
}

interface TrimData {
  id: string;
  name: string;
  price: number;
  discountPrice: number | null;
  evSubsidy: number | null;
  engineType: string;
  fuelEfficiency: number | null;
  isDefault: boolean;
  specs: Record<string, string> | null;
  options: TrimOption[];
  rules: TrimRule[];
  lineupId: string | null;
  lineup: { id: string; name: string } | null;
  availableProducts: ("장기렌트" | "리스")[];
}

// ════════════════════════════════════════════════════════════
// 메인 — v2 (2회차: STEP 2 탭 + 실제 API 연동)
// ════════════════════════════════════════════════════════════
export function QuoteClientPageV2({ vehicles }: { vehicles: VehicleListItem[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillSlug = searchParams?.get("vehicle") ?? undefined;
  const prefillTrimId = searchParams?.get("trim") ?? undefined;
  const customerTypeParam = searchParams?.get("customerType") ?? null;
  const initialCustomerType = isCustomerType(customerTypeParam) ? customerTypeParam : null;
  const isRestoreReturn = searchParams?.get("restore") === "1";
  // 로그인 게이트를 통과하고 돌아왔다는 표식 — 견적서 요청 흐름을 1회 자동 재개한다.
  const isDeliveryResumeReturn = searchParams?.get(DELIVERY_RESUME_PARAM) === "1";
  const prefillOptionsParam = searchParams?.get("options") ?? "";
  const productTypeParam = searchParams?.get("productType");
  const initialProductType = productTypeParam === "리스"
    ? "리스"
    : DEFAULT_PUBLIC_QUOTE_PRODUCT_TYPE;
  const contractMonthsParam = Number(searchParams?.get("contractMonths"));
  const initialContractMonths = [36, 48, 60].includes(contractMonthsParam)
    ? contractMonthsParam
    : PUBLIC_CARD_QUOTE_CONDITION.contractMonths;
  const annualMileageParam = Number(searchParams?.get("annualMileage"));
  const initialAnnualMileage = [10_000, 20_000, 30_000].includes(annualMileageParam)
    ? annualMileageParam
    : PUBLIC_CARD_QUOTE_CONDITION.annualMileage;
  const draftSource = searchParams?.get("source") === "AI" ? "AI" : "DETAIL" as const;

  const [quoteSessionId] = useState(() => {
    // 게이트 로그인 복귀(deliver=1)면 직전 견적 세션을 이어받는다.
    // 매 마운트마다 새 UUID 를 만들면 OAuth 왕복을 기준으로 퍼널이 끊긴다.
    if (isDeliveryResumeReturn && typeof window !== "undefined") {
      const pending = window.localStorage.getItem(DELIVERY_GATE_SESSION_KEY);
      if (pending) {
        window.localStorage.removeItem(DELIVERY_GATE_SESSION_KEY);
        return pending;
      }
    }
    return typeof crypto !== "undefined" ? crypto.randomUUID() : `quote-${Date.now()}`;
  });
  const { track } = useTracking();
  // 로그인 상태 — 복원된 비회원 게이트 견적을 회원 자격으로 다시 계산할 때 사용.
  const { user: authUser } = useAuthUser();
  // 게이트 표시 이벤트는 마운트당 1회만 — 모달을 닫았다 다시 여는 반복이 카운트를 부풀리지 않게.
  const deliveryGateShownTracked = useRef(false);

  const restoreRef = useRef<QuoteImageRestoreState | null>(null);

  const [step, setStep] = useState<1 | 2 | 3>(() =>
    isRestoreReturn ? 3 : initialCustomerType ? 2 : 1
  );
  const [customerType, setCustomerType] = useState<CustomerType>(
    initialCustomerType ?? "individual"
  );
  const [selectedVehicle] = useState<VehicleListItem | null>(() =>
    prefillSlug ? vehicles.find((v) => v.slug === prefillSlug) ?? null : null
  );

  useEffect(() => {
    if (!prefillSlug) {
      router.replace("/cars");
    }
  }, [prefillSlug, router]);

  const [quoteResult, setQuoteResult] = useState<QuoteResponse | null>(null);
  const stepRef = useRef<1 | 2 | 3>(step);
  stepRef.current = step;
  const quoteResultHistoryOpenRef = useRef(false);
  const swallowResultHistoryPopRef = useRef(false);

  const goToStep = useCallback((s: 1 | 2 | 3) => {
    setStep(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // ─── 트림/옵션/색상/조건 상태 (v1 계약 그대로) ─────────
  const [trims, setTrims] = useState<TrimData[]>([]);
  const [trimsLoading, setTrimsLoading] = useState(false);
  const [trimsLoaded, setTrimsLoaded] = useState(false);
  const [colorsLoaded, setColorsLoaded] = useState(false);
  const [colorsError, setColorsError] = useState(false);
  const [trimsError, setTrimsError] = useState(false);
  const [selectedLineup, setSelectedLineup] = useState<string | null>(null);
  const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set());
  const [colors, setColors] = useState<VehicleColorPublic[]>([]);
  const [exteriorColorId, setExteriorColorId] = useState<string | null>(null);
  const [interiorColorId, setInteriorColorId] = useState<string | null>(null);
  const [prefillFallbackNotice, setPrefillFallbackNotice] = useState<string | null>(null);

  const [contractCategory, setContractCategory] = useState<"장기렌트" | "리스">(initialProductType);
  const [conditions, setConditions] = useState<{ contractMonths: number; annualMileage: number }>({
    contractMonths: initialContractMonths,
    annualMileage: initialAnnualMileage,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConsultationSubmitting, setIsConsultationSubmitting] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);

  // ─── 보증금/선납/CTA 상태 — 결과 첫 화면은 선납 30% / 있음 ──
  const [customRates, setCustomRates] = useState({
    depositRate: DEFAULT_RESULT_CUSTOM_RATES.depositRate,
    prepayRate: DEFAULT_RESULT_CUSTOM_RATES.prepayRate,
  });
  const [costMode, setCostMode] = useState<CostMode>(DEFAULT_RESULT_COST_MODE);
  const [isRecalculating, setIsRecalculating] = useState(false);
  // 슬라이더 재계산 실패 — 화면 금액이 새 조건이 아니라는 사실을 고객에게 알린다.
  const [recalculationError, setRecalculationError] = useState<string | null>(null);
  // 복원 표식(restore=1)으로 돌아왔는데 저장본이 없을 때의 폴백 안내.
  const [restoreSnapshotMissing, setRestoreSnapshotMissing] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [isDelivering, setIsDelivering] = useState(false);
  const [deliverSuccess, setDeliverSuccess] = useState(false);
  // 클립보드에 복사한 견적 요청 메시지. 모달을 닫은 뒤에도 '대화창 다시 열기'에서 재복사하므로
  // 모달 열림 상태(deliveryGuideOpen)와 분리해 보관한다.
  const [deliveryRequestMessage, setDeliveryRequestMessage] = useState<string | null>(null);
  const [deliveryGuideOpen, setDeliveryGuideOpen] = useState(false);
  // 대기 모드면 상담전환톡이 이미 나갔으므로 안내 문구가 달라진다.
  const [deliveryGuideVariant, setDeliveryGuideVariant] = useState<"paste" | "alimtalk">(
    "paste"
  );
  // 웹은 고객이 실제로 대화창에서 전송했는지 알 수 없다 — '보냈어요' 자가 확인으로 받는다.
  const [deliveryConfirmedBySender, setDeliveryConfirmedBySender] = useState(false);
  const [deliveryTrackContext, setDeliveryTrackContext] =
    useState<ChannelTalkQuoteContext | null>(null);
  // 로그인 게이트 — 견적서 수령 / 초기비용 변경. 비회원이 눌렀을 때 노출한다.
  const [loginGate, setLoginGate] = useState<"delivery" | "initialCost" | null>(null);
  // 아임딜러 채널 알림톡 자동발송은 카카오싱크 + 명시적 자동발송 플래그가 모두 켜졌을 때만.
  // (KAKAO_SYNC 는 간편가입 로그인용이라, 자동발송과는 분리한다. 다만 견적서 수령은
  //  회원 전용이고 로그인이 카카오싱크라 실질적으로 함께 켜져 있어야 한다.)
  const kakaoDeliveryEnabled =
    isKakaoSyncEnabled() && process.env.NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND === "true";
  // 자동발송 전 임시방편: '견적서 받기' → 카카오 채널추가 유도 →
  // 채널톡(↔카카오 채널 통합)으로 상담사가 확인 후 견적서를 수동 발송한다.
  const channelTalkDelivery = !kakaoDeliveryEnabled;
  const baseStandardScenario = useRef<QuoteScenarioDetail | null>(null);
  const recalculateRequestId = useRef(0);
  const lastQuotedSlug = useRef<string | null>(null);
  const pendingRatesReapply = useRef(false);
  const pendingRecalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recalcInFlightRef = useRef<Promise<void> | null>(null);
  const recalculateStandardRef = useRef<(
    rates: { depositRate: number; prepayRate: number }
  ) => Promise<void>>(async () => {});

  const hasPrefilled = useRef(false);

  // ─── 트림/색상 fetch (v1 계약 그대로 + 에러 복구) ──────
  const loadVehicleDetails = useCallback(() => {
    if (!selectedVehicle) return;
    const slug = selectedVehicle.slug;
    setTrimsLoading(true);
    setTrimsLoaded(false);
    setTrimsError(false);
    setTrims([]);
    setSelectedLineup(null);
    setSelectedTrimId(null);
    setSelectedOptionIds(new Set());
    setColors([]);
    setColorsLoaded(false);
    setColorsError(false);
    setExteriorColorId(null);
    setInteriorColorId(null);

    fetch(`/api/vehicles/${slug}/colors`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`colors ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!json?.success || !Array.isArray(json.data)) {
          throw new Error("colors payload invalid");
        }
        const list: VehicleColorPublic[] = json.data;
        setColors(list);
        const defaultExt = pickDefaultColor(list, "EXTERIOR");
        const defaultInt = pickDefaultColor(list, "INTERIOR");
        const restore = restoreRef.current;
        const restoreExt = restore ? list.find((c) => c.id === restore.exteriorColorId) : undefined;
        const restoreInt = restore ? list.find((c) => c.id === restore.interiorColorId) : undefined;
        setExteriorColorId(restoreExt?.id ?? defaultExt?.id ?? null);
        setInteriorColorId(restoreInt?.id ?? defaultInt?.id ?? null);
        setColorsError(false);
        setColorsLoaded(true);
      })
      .catch(() => {
        // 자동 재시도는 하지 않는다 — 실패 루프와 priceDelta 미반영 견적을 막는다.
        setColors([]);
        setColorsLoaded(false);
        setColorsError(true);
        setExteriorColorId(null);
        setInteriorColorId(null);
      });

    fetch(`/api/vehicles/${slug}/trims`)
      .then((r) => r.json())
      .then((trimsJson) => {
        if (!trimsJson?.success || !Array.isArray(trimsJson.data)) return;
        const loadedTrims: TrimData[] = trimsJson.data;
        setTrimsLoaded(true);
        if (loadedTrims.length === 0) return;
        setTrims(loadedTrims);

        const hasLineupInfo = loadedTrims.some(
          (t) => t.lineup?.name ?? (t.specs as Record<string, string> | null)?.lineup
        );

        const restore = restoreRef.current;
        if (restore && !hasPrefilled.current) {
          hasPrefilled.current = true;
          const restoreTrim =
            loadedTrims.find((t) => t.id === restore.quoteResult.trimId) ??
            loadedTrims.find((t) => t.isDefault) ??
            loadedTrims[0];
          const specs = restoreTrim.specs as Record<string, string> | null;
          const resolvedLineupName = restoreTrim.lineup?.name ?? specs?.lineup ?? "";
          if (hasLineupInfo && resolvedLineupName) {
            setSelectedLineup(resolvedLineupName);
            setSelectedTrimId(restoreTrim.id);
          } else {
            setSelectedLineup(restoreTrim.id);
          }
          if (restore.selectedOptionIds.length > 0) {
            const validIds = new Set(restoreTrim.options.map((o: TrimOption) => o.id));
            const toSelect = restore.selectedOptionIds.filter((id) => validIds.has(id));
            if (toSelect.length > 0) setSelectedOptionIds(new Set(toSelect));
          }
        } else if (prefillTrimId && !hasPrefilled.current) {
          hasPrefilled.current = true;
          const lineupNameOf = (t: TrimData): string =>
            t.lineup?.name ?? (t.specs as Record<string, string> | null)?.lineup ?? "";
          const hasLineup = loadedTrims.some((t) => lineupNameOf(t));
          const recommendedTrim = loadedTrims.find((t) => t.id === prefillTrimId);
          const fallbackTrim =
            loadedTrims.find((t) => t.isDefault) ?? loadedTrims[0];
          const appliedTrim = recommendedTrim ?? fallbackTrim;
          if (!appliedTrim) return;
          if (!recommendedTrim) {
            setPrefillFallbackNotice(PREFILL_FALLBACK_MESSAGE);
          }
          const resolvedLineupName = lineupNameOf(appliedTrim);
          if (hasLineup && resolvedLineupName) {
            setSelectedLineup(resolvedLineupName);
            setSelectedTrimId(appliedTrim.id);
          } else {
            setSelectedLineup(appliedTrim.id);
          }
          const prefillOptionIds = prefillOptionsParam.split(",").filter(Boolean);
          if (recommendedTrim && prefillOptionIds.length > 0) {
            const validIds = new Set(recommendedTrim.options.map((o: TrimOption) => o.id));
            const toSelect = prefillOptionIds.filter((id) => validIds.has(id));
            if (toSelect.length > 0) setSelectedOptionIds(new Set(toSelect));
          }
        }
      })
      .catch(() => {
        // 트림 로딩 실패 시 데드엔드 방지: 에러 상태를 설정해 재시도 UI 노출.
        setTrimsError(true);
      })
      .finally(() => setTrimsLoading(false));
  }, [selectedVehicle, prefillOptionsParam, prefillTrimId]);

  const retryLoadColors = useCallback(() => {
    if (!selectedVehicle) return;
    const slug = selectedVehicle.slug;
    setColorsError(false);
    setColorsLoaded(false);
    fetch(`/api/vehicles/${slug}/colors`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`colors ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (!json?.success || !Array.isArray(json.data)) {
          throw new Error("colors payload invalid");
        }
        const list: VehicleColorPublic[] = json.data;
        setColors(list);
        const defaultExt = pickDefaultColor(list, "EXTERIOR");
        const defaultInt = pickDefaultColor(list, "INTERIOR");
        const restore = restoreRef.current;
        const restoreExt = restore ? list.find((c) => c.id === restore.exteriorColorId) : undefined;
        const restoreInt = restore ? list.find((c) => c.id === restore.interiorColorId) : undefined;
        setExteriorColorId(restoreExt?.id ?? defaultExt?.id ?? null);
        setInteriorColorId(restoreInt?.id ?? defaultInt?.id ?? null);
        setColorsError(false);
        setColorsLoaded(true);
      })
      .catch(() => {
        setColors([]);
        setColorsLoaded(false);
        setColorsError(true);
        setExteriorColorId(null);
        setInteriorColorId(null);
      });
  }, [selectedVehicle]);

  useEffect(() => {
    loadVehicleDetails();
  }, [loadVehicleDetails]);

  // ─── 복원 (v1 계약 그대로) ─────────────────────────────
  useEffect(() => {
    if (!isRestoreReturn) return;
    const restored = readQuoteImageRestore();
    if (restored && restored.vehicleSlug === prefillSlug) {
      restoreRef.current = restored;
      baseStandardScenario.current =
        restored.baseStandard ?? restored.quoteResult.scenarios.standard;
      setCustomerType(restored.customerType);
      setContractCategory(restored.contractCategory);
      setConditions({
        contractMonths: restored.conditions.contractMonths,
        annualMileage: restored.conditions.annualMileage,
      });
      setCustomRates(restored.customRates);
      setCostMode(
        restored.costMode ??
          (restored.customRates.prepayRate > 0 || restored.customRates.depositRate > 0
            ? DEFAULT_RESULT_COST_MODE
            : "none")
      );
      lastQuotedSlug.current = restored.vehicleSlug;
      setQuoteResult(restored.quoteResult);
      setStep(3);
    } else {
      // 저장본이 없거나 다른 차량 것이다 — 빈 결과 화면에 갇히지 않게 조건 단계로
      // 되돌리되, 왜 처음부터 다시인지 안내한다(로그인 왕복 복귀 포함).
      setRestoreSnapshotMissing(true);
      setStep(initialCustomerType ? 2 : 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 로그인 복귀 회원의 잠긴 견적 자동 갱신 ─────────────
  // 게이트 로그인 왕복 뒤 복원된 quoteResult 는 여전히 비회원 게이트 응답
  // (standard·conservative 잠금)일 수 있다. 그대로 두면 없음(무보증) 선택이
  // 잠긴 기준 시나리오를 되살려 화면이 선납 30% 금액에 계속 머문다 —
  // 회원 자격으로 한 번 다시 계산해 실제 금액 payload 로 교체한다.
  const memberUnlockRequested = useRef(false);
  useEffect(() => {
    if (!authUser || !quoteResult?.trimId) return;
    if (!hasLockedQuoteScenario(quoteResult)) return;
    if (memberUnlockRequested.current) return;
    memberUnlockRequested.current = true;
    void (async () => {
      try {
        const fresh = await requestCalculatedQuoteForDelivery({
          depositRate: 0,
          prepayRate: 0,
        });
        baseStandardScenario.current = fresh.scenarios.standard ?? null;
        recalculateRequestId.current += 1;
        setIsRecalculating(false);
        // 사용자가 고른 초기비용 조건은 새 기준 payload 위에 다시 계산해 얹는다.
        pendingRatesReapply.current = true;
        setQuoteResult(fresh);
      } catch {
        // 갱신 실패 — 이후 비율 변경/없음 선택의 재계산 경로가 다시 시도한다.
        memberUnlockRequested.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, quoteResult]);

  // ─── 캐스케이딩 파생 값 (v1 계약 그대로) ───────────────
  const getLineupName = (t: TrimData): string =>
    t.lineup?.name ?? (t.specs as Record<string, string> | null)?.lineup ?? "";

  const hasCascade = trims.some((t) => getLineupName(t));
  const availableLineups = hasCascade
    ? sortLineups([...new Set(trims.map((t) => getLineupName(t)).filter(Boolean))])
    : [];
  const trimsForLineup = selectedLineup
    ? trims.filter((t) => getLineupName(t) === selectedLineup)
    : [];
  const availableTrimNames = (() => {
    const list = trimsForLineup.map((t) => {
      const trimName = (t.specs as Record<string, string>)?.trimName ?? t.name;
      const extra =
        t.name !== trimName && t.name.includes(trimName)
          ? t.name.replace(trimName, "").trim().replace(/\s+/g, " ")
          : null;
      return { id: t.id, name: trimName, extra, price: t.price, discountPrice: t.discountPrice };
    });
    const nameCount = new Map<string, number>();
    list.forEach((it) => nameCount.set(it.name, (nameCount.get(it.name) ?? 0) + 1));
    return list.map((it) => ({
      ...it,
      extra: (nameCount.get(it.name) ?? 0) > 1 ? it.extra : null,
    }));
  })();

  const lineupChoices: LineupChoice[] = availableLineups.map((lineup) => ({
    name: lineup,
    trimCount: trims.filter((t) => getLineupName(t) === lineup).length,
  }));
  const cascadeTrimChoices: TrimChoice[] = availableTrimNames.map((t) => ({
    id: t.id,
    name: t.name,
    extra: t.extra,
    price: t.price,
    discountPrice: t.discountPrice ?? null,
  }));
  const flatTrimChoices: TrimChoice[] = trims.map((t) => ({
    id: t.id,
    name: t.name,
    extra: null,
    price: t.price,
    discountPrice: t.discountPrice ?? null,
  }));

  const selectedTrim: TrimData | null = hasCascade
    ? (selectedTrimId ? trimsForLineup.find((t) => t.id === selectedTrimId) ?? null : null)
    : trims.find((t) => t.id === selectedLineup) ?? null;

  const optionsTotalPrice = selectedTrim
    ? selectedTrim.options
        .filter((o) => selectedOptionIds.has(o.id))
        .reduce((sum, o) => sum + o.price, 0)
    : 0;

  const selectedExteriorColor = exteriorColorId ? colors.find((c) => c.id === exteriorColorId) ?? null : null;
  const selectedInteriorColor = interiorColorId ? colors.find((c) => c.id === interiorColorId) ?? null : null;
  const colorDelta = (selectedExteriorColor?.priceDelta ?? 0) + (selectedInteriorColor?.priceDelta ?? 0);

  const selectedOptionDetails =
    selectedTrim?.options
      .filter((option) => selectedOptionIds.has(option.id))
      .map((option) => ({ id: option.id, name: option.name, price: option.price })) ?? [];
  const canRequestConsultation = trimsLoaded && trims.length === 0;

  // ─── 옵션 토글 (REQUIRED/INCLUDED/CONFLICT 룰 — v1 계약 그대로) ──
  const handleOptionToggle = useCallback((optionId: string) => {
    setSelectedOptionIds((prev) => {
      const rules = selectedTrim?.rules ?? [];
      const next = new Set(prev);
      if (next.has(optionId)) {
        next.delete(optionId);
      } else {
        next.add(optionId);
        for (const rule of rules) {
          if (rule.sourceOptionId === optionId &&
            (rule.ruleType === "REQUIRED" || rule.ruleType === "INCLUDED")) {
            next.add(rule.targetOptionId);
          }
        }
        for (const rule of rules) {
          if (rule.sourceOptionId === optionId && rule.ruleType === "CONFLICT") {
            next.delete(rule.targetOptionId);
          }
        }
      }
      return next;
    });
  }, [selectedTrim]);

  // ─── 견적 계산 API (v1 계약 그대로) ────────────────────
  async function fetchQuote() {
    if (!selectedVehicle || (!selectedTrim && !canRequestConsultation)) return;
    // 색상 API 가 실패한 채 견적하면 priceDelta 가 빠진다 — 진행을 막는다.
    if (selectedTrim && colorsError) return;
    setIsLoading(true);
    setError(null);
    try {
      const requestBody = {
        sessionId: quoteSessionId,
        selectedOptionIds: selectedTrim ? Array.from(selectedOptionIds) : [],
        contractMonths: conditions.contractMonths,
        annualMileage: conditions.annualMileage,
        contractType: "반납형",
        productType: contractCategory,
        customerType,
        exteriorColorId: selectedTrim ? exteriorColorId : null,
        interiorColorId: selectedTrim ? interiorColorId : null,
        ...(selectedTrim ? { trimId: selectedTrim.id } : {}),
      };
      const res = await fetch(`/api/vehicles/${selectedVehicle.slug}/quote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error ?? "견적 계산에 실패했습니다.");
        return;
      }
      const nextResult = json.data as QuoteResponse;
      recalculateRequestId.current += 1;
      baseStandardScenario.current = nextResult.scenarios.standard ?? null;

      // 같은 차량 재계산이면 초기비용 설정 유지, 다른 차량·첫 계산이면 선납 30% 기본
      if (lastQuotedSlug.current === selectedVehicle.slug) {
        pendingRatesReapply.current = true;
      } else {
        setCustomRates({
          depositRate: DEFAULT_RESULT_CUSTOM_RATES.depositRate,
          prepayRate: DEFAULT_RESULT_CUSTOM_RATES.prepayRate,
        });
        setCostMode(DEFAULT_RESULT_COST_MODE);
      }
      lastQuotedSlug.current = selectedVehicle.slug;
      setQuoteResult(nextResult);
      goToStep(3);
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsLoading(false);
    }
  }

  // 복원 직후 트림 목록이 로드되기 전에는 state가 비어 있다 —
  // 저장/재계산 모두 복원 스냅샷의 옵션을 써야 같은 조건으로 계산된다.
  const getEffectiveSelectedOptionIds = useCallback((): string[] => {
    const currentOptionIds = Array.from(selectedOptionIds);
    const restored = restoreRef.current;
    if (
      trimsLoaded ||
      !restored ||
      restored.vehicleSlug !== quoteResult?.vehicleSlug
    ) {
      return currentOptionIds;
    }
    return [...restored.selectedOptionIds];
  }, [quoteResult?.vehicleSlug, selectedOptionIds, trimsLoaded]);

  // 색상도 같은 문제가 있다 — 색상 목록 로드 전에는 state가 null이라
  // 복원된 색상 선택이 저장/재계산에서 빠질 수 있다.
  const getEffectiveSelectedColorIds = useCallback((): {
    exteriorColorId: string | null;
    interiorColorId: string | null;
  } => {
    const restored = restoreRef.current;
    if (
      colorsLoaded ||
      !restored ||
      restored.vehicleSlug !== quoteResult?.vehicleSlug
    ) {
      return { exteriorColorId, interiorColorId };
    }
    return {
      exteriorColorId: restored.exteriorColorId ?? null,
      interiorColorId: restored.interiorColorId ?? null,
    };
  }, [quoteResult?.vehicleSlug, exteriorColorId, interiorColorId, colorsLoaded]);

  // ─── 보증금/선납 재계산 (v1 계약 그대로) ───────────────
  async function recalculateStandard(rates: { depositRate: number; prepayRate: number }) {
    const run = (async () => {
      if (!selectedVehicle || !quoteResult) return;
      const requestId = recalculateRequestId.current + 1;
      recalculateRequestId.current = requestId;

      if (rates.depositRate === 0 && rates.prepayRate === 0) {
        // 기준(무보증) 시나리오가 실제 금액일 때만 캐시 복원. 잠긴 기준(비회원
        // 게이트 응답을 로그인 후 복원한 세션 등)을 되살리면 화면이 선납 30%
        // 금액에 머무르므로, 그 경우 아래 fetch 로 회원 자격 재계산을 태운다.
        if (isDisplayableQuoteScenario(baseStandardScenario.current ?? undefined)) {
          restoreBaseStandardScenario();
          return;
        }
      }

      setIsRecalculating(true);
      setRecalculationError(null);
      try {
        const res = await fetch(`/api/vehicles/${selectedVehicle.slug}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: quoteSessionId,
            trimId: selectedTrim?.id ?? quoteResult.trimId,
            selectedOptionIds: getEffectiveSelectedOptionIds(),
            contractMonths: conditions.contractMonths,
            annualMileage: conditions.annualMileage,
            contractType: "반납형",
            productType: contractCategory,
            customDepositRate: rates.depositRate,
            customPrepayRate: rates.prepayRate,
            customerType,
            ...getEffectiveSelectedColorIds(),
          }),
        });
        const json = await res.json();
        if (!res.ok || !json.success) {
          console.error("[recalculateStandard]", json?.error ?? "failed");
          // 조용히 넘어가면 직전 조건 금액이 새 조건 금액으로 오인된다 —
          // 실패를 화면에 알리고 재계산 경로를 남긴다.
          if (requestId === recalculateRequestId.current) {
            setRecalculationError(RECALCULATION_ERROR_MESSAGE);
          }
          return;
        }
        if (requestId !== recalculateRequestId.current) return;

        if (rates.depositRate === 0 && rates.prepayRate === 0) {
          // 잠긴 기준을 우회한 무보증 재계산 — 응답 standard 가 새 기준이 된다.
          baseStandardScenario.current = json.data.scenarios.standard ?? null;
        }
        setQuoteResult((prev) =>
          prev
            ? { ...prev, scenarios: { ...prev.scenarios, standard: json.data.scenarios.standard } }
            : prev
        );
      } catch (recalculationFailure) {
        // 네트워크 실패도 화면에 알린다. 저장/전송 경로(flushPendingQuoteRecalculation)는
        // 이 거부를 그대로 받아야 낡은 금액으로 저장되지 않으므로 다시 던진다.
        if (requestId === recalculateRequestId.current) {
          setRecalculationError(RECALCULATION_ERROR_MESSAGE);
        }
        throw recalculationFailure;
      } finally {
        if (requestId === recalculateRequestId.current) {
          setIsRecalculating(false);
        }
      }
    })();
    recalcInFlightRef.current = run;
    try {
      await run;
    } finally {
      if (recalcInFlightRef.current === run) {
        recalcInFlightRef.current = null;
      }
    }
  }
  recalculateStandardRef.current = recalculateStandard;

  const restoreBaseStandardScenario = useCallback(() => {
    recalculateRequestId.current += 1;
    setIsRecalculating(false);
    setRecalculationError(null);
    const standard = baseStandardScenario.current;
    if (!standard) return;
    setQuoteResult((prev) =>
      prev ? { ...prev, scenarios: { ...prev.scenarios, standard } } : prev
    );
  }, []);

  // 슬라이더 변경 시 500ms 디바운스 재계산 (v1 계약 그대로)
  useEffect(() => {
    if (!quoteResult || !selectedVehicle) return;
    const rates = customRates;
    const handle = setTimeout(() => {
      if (pendingRecalcTimerRef.current === handle) {
        pendingRecalcTimerRef.current = null;
      }
      // 거부는 recalculateStandard 안에서 이미 에러 상태로 표면화한다 —
      // 여기서 삼키지 않으면 디바운스 타이머에서 미처리 rejection 이 된다.
      void recalculateStandardRef.current(rates).catch(() => {});
    }, 500);
    pendingRecalcTimerRef.current = handle;
    return () => {
      clearTimeout(handle);
      if (pendingRecalcTimerRef.current === handle) {
        pendingRecalcTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customRates.depositRate, customRates.prepayRate]);

  // 같은 차량 재계산 직후 보존된 비율 재적용 (v1 계약 그대로)
  useEffect(() => {
    if (!pendingRatesReapply.current || !quoteResult) return;
    pendingRatesReapply.current = false;
    // 거부는 recalculateStandard 안에서 이미 화면에 표면화한다 — 여기 걸어두지
    // 않으면 미처리 rejection 이 된다.
    void recalculateStandard(customRates).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteResult, customRates]);

  const flushPendingQuoteRecalculation = useCallback(async () => {
    const pendingTimer = pendingRecalcTimerRef.current;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingRecalcTimerRef.current = null;
    }
    if (recalcInFlightRef.current) {
      await recalcInFlightRef.current;
    }
    if (pendingTimer) {
      await recalculateStandardRef.current(customRates);
    }
  }, [customRates]);

  const saveCurrentQuote = useCallback(async () => {
    if (!quoteResult?.trimId) {
      throw new Error("상담 요청을 저장하려면 트림을 선택해 주세요.");
    }

    await flushPendingQuoteRecalculation();

    const saveRes = await fetch("/api/quote/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: quoteSessionId,
        vehicleSlug: quoteResult.vehicleSlug,
        trimId: quoteResult.trimId,
        selectedOptionIds: getEffectiveSelectedOptionIds(),
        contractMonths: quoteResult.contractMonths,
        annualMileage: quoteResult.annualMileage,
        contractType: "반납형",
        customerType,
        productType: contractCategory,
        scenarioType: deriveQuoteScenarioType(customRates),
        customDepositRate: customRates.depositRate,
        customPrepayRate: customRates.prepayRate,
        ...getEffectiveSelectedColorIds(),
        quoteType: draftSource,
      }),
    });
    const responsePayload: unknown = await saveRes.json().catch(() => null);
    const savedQuoteResult = savedQuoteResponseSchema.safeParse(responsePayload);
    if (!saveRes.ok || !savedQuoteResult.success) {
      const apiErrorResult = apiErrorSchema.safeParse(responsePayload);
      const loginHref = quoteSaveLoginRedirect({
        status: saveRes.status,
        code: apiErrorResult.success ? apiErrorResult.data.code : undefined,
        returnPath:
          typeof window !== "undefined"
            ? `${window.location.pathname}${window.location.search}`
            : "/quote",
      });
      if (loginHref) {
        const {
          data: { user },
        } = await createClient().auth.getUser();
        if (!user) {
          router.push(loginHref);
          throw new Error("로그인이 필요합니다.");
        }
      }
      throw new Error(
        apiErrorResult.success && apiErrorResult.data.error
          ? apiErrorResult.data.error
          : "견적 저장에 실패했습니다. 잠시 후 다시 시도해주세요."
      );
    }
    const savedQuote = savedQuoteResult.data.data;
    setQuoteResult((prev) =>
      prev ? applySavedQuoteAmountsToDisplay(prev, savedQuote) : prev
    );
    // 저장 확정 응답은 서버가 같은 요율로 재계산한 금액이다 — 화면 금액이 그것으로
    // 덮어졌으므로 "새 조건이 아니"라는 재계산 실패 안내는 이제 사실이 아니다.
    // 「다시 계산하지 못했어요」와 「보냈어요」가 함께 뜨는 모순을 없앤다.
    setRecalculationError(null);
    // Google Ads '견적 요청' 전환. 상담 요청·카톡 전송이 모두 이 저장을 거치므로
    // 여기 한 곳에서 발사하고, 같은 견적 ID 는 내부에서 한 번만 집계된다.
    trackQuoteRequestConversion({ quoteId: savedQuote.id });
    return savedQuote;
  }, [
    quoteResult,
    quoteSessionId,
    getEffectiveSelectedOptionIds,
    customerType,
    contractCategory,
    customRates,
    getEffectiveSelectedColorIds,
    draftSource,
    flushPendingQuoteRecalculation,
    router,
  ]);

  const handleConsultationRequest = useCallback(async () => {
    if (!quoteResult || isConsultationSubmitting) return;
    setIsConsultationSubmitting(true);
    setConsultationError(null);
    try {
      const savedQuote = await saveCurrentQuote();
      const opened = openChannelTalkWithQuote({
        quoteId: savedQuote.id,
        sessionId: savedQuote.sessionId,
        vehicleName: selectedVehicle?.name ?? "",
        trimName: quoteResult.trimName,
        productType: contractCategory,
        contractMonths: quoteResult.contractMonths,
        annualMileage: quoteResult.annualMileage,
      });
      if (!opened) {
        setConsultationError("상담창을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.");
      }
    } catch (saveError) {
      setConsultationError(
        saveError instanceof Error
          ? saveError.message
          : "상담 요청 저장에 실패했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setIsConsultationSubmitting(false);
    }
  }, [
    quoteResult,
    isConsultationSubmitting,
    saveCurrentQuote,
    selectedVehicle,
    contractCategory,
  ]);

  // ─── 카카오톡으로 견적서 전송 ─────────────────────────────
  // auto: true 는 로그인 왕복 복귀의 자동 재개다 — 409 재동의 요구를 만나도
  // 제스처 없이 동의창으로 되돌아가면(복귀 → 자동 재개 → 409 → …) 무한 왕복이
  // 되므로 안내로 멈춘다. 수동 클릭(auto: false)은 기존대로 동의 흐름을 탄다.
  async function deliverQuoteToKakao(auto: boolean): Promise<void> {
    if (!kakaoDeliveryEnabled || !quoteResult) return;
    setIsDelivering(true);
    setDeliveryError(null);
    setDeliverSuccess(false);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        // 비회원 — 바로 OAuth 로 보내지 않고 게이트 모달로 설득한다(채널톡 경로와 동일).
        // 모달 CTA(handleDeliveryLoginGateConfirm)가 deliver=1 복귀 표식과
        // 자동 재개 1회분을 챙기므로 여기서는 노출만 한다. 자동 재개 레인이
        // 여기 도달한 경우(로그인이 풀린 극한 레이스)에도 모달은 루프를 만들지 않는다.
        showDeliveryLoginGate();
        return;
      }

      if (hasLockedQuoteScenario(quoteResult)) {
        await refreshQuoteForDelivery();
      }

      const savedQuote = await saveCurrentQuote();
      const response = await fetch("/api/quote/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedQuoteId: savedQuote.id,
          sessionId: savedQuote.sessionId,
        }),
      });
      const responsePayload: unknown = await response.json().catch(() => null);
      const apiErrorResult = apiErrorSchema.safeParse(responsePayload);

      if (!response.ok) {
        const requiresReauth =
          response.status === 401 ||
          (apiErrorResult.success &&
            apiErrorResult.data.code === "KAKAO_REAUTH_REQUIRED");
        if (requiresReauth) {
          if (auto) {
            // 다시 나가면 루프다 — 안내 + 수동 재시도(하단 버튼)로 멈춘다.
            setDeliveryError(KAKAO_REAUTH_MANUAL_RETRY_MESSAGE);
            return;
          }
          // 수동 클릭의 재동의 왕복 — 돌아오면 자동으로 이어지도록 1회분을 허용한다.
          grantAutoDeliveryResume();
          await startKakaoConsentFlow();
          return;
        }
        setDeliveryError(
          apiErrorResult.success && apiErrorResult.data.error
            ? apiErrorResult.data.error
            : "카카오톡 전송에 실패했습니다."
        );
        return;
      }

      setDeliverSuccess(true);
    } catch (deliverError) {
      if (!(deliverError instanceof Error)) throw deliverError;
      setDeliveryError(
        deliverError.message ||
          "전송 중 네트워크 오류가 발생했습니다."
      );
    } finally {
      setIsDelivering(false);
    }
  }

  async function handleQuoteDeliver() {
    await deliverQuoteToKakao(false);
  }

  /**
   * 비회원 견적서 수령 게이트 노출. 카카오 자동발송·채널톡 두 경로가 공유한다 —
   * 어느 경로든 비회원은 OAuth 로 직행하지 않고 먼저 이 모달로 설득한다.
   * 퍼널 이벤트는 세션당 1회만 기록한다(QuoteCalcLog 와 조인용).
   */
  function showDeliveryLoginGate() {
    setDeliveryError(null);
    setDeliverSuccess(false);
    setLoginGate("delivery");
    if (!deliveryGateShownTracked.current) {
      deliveryGateShownTracked.current = true;
      void track("delivery_gate_shown", {
        sessionId: quoteSessionId,
        vehicleId: selectedVehicle?.id,
        metadata: { vehicleSlug: selectedVehicle?.slug },
      });
    }
  }

  // ─── 임시방편: 견적서 받기 → 안내 모달 → 카카오 채널 대화창 (비즈톡 자동발송 전) ───
  // ① 견적 저장 + 채널톡 track(상담사용 컨텍스트) + 요청 메시지 클립보드 복사
  // ② 안내 모달을 띄워 "복사했어요, 붙여넣어 보내주세요"를 이동 전에 반드시 읽게 한다.
  // ③ 모달 CTA 클릭 시(handleDeliveryGuideConfirm) 대화창을 연다 — 클릭 직후 동기
  //    실행이라 팝업 차단에 안 걸린다. 여기서 바로 열면 await 뒤라 차단되어
  //    고객이 채널 홈에 떨어진다(채널추가 팝업만 열리던 기존 문제).
  async function handleQuoteReceiveViaChannelTalk() {
    if (!quoteResult || isDelivering) return;
    if (!kakaoChannelChatUrl()) {
      setDeliveryError("카카오 채널 설정을 확인해 주세요. 잠시 후 다시 시도해주세요.");
      return;
    }
    // 견적서 수령은 회원 전용 — 비회원이면 저장·복사 전에 로그인 게이트로 보낸다.
    if (!(await hasActiveSession())) {
      showDeliveryLoginGate();
      return;
    }
    setIsDelivering(true);
    setDeliveryError(null);
    setDeliverSuccess(false);
    setDeliveryConfirmedBySender(false);

    try {
      const savedQuote = await saveCurrentQuote();
      const vehicleName = selectedVehicle?.name ?? "";
      // 상담사가 채널톡 데스크에서 볼 견적 요청 컨텍스트를 기록.
      const deliveryContext: ChannelTalkQuoteContext = {
        quoteId: savedQuote.id,
        sessionId: savedQuote.sessionId,
        vehicleName,
        trimName: quoteResult.trimName,
        productType: contractCategory,
        contractMonths: quoteResult.contractMonths,
        annualMileage: quoteResult.annualMileage,
      };
      trackQuoteDeliveryRequested(deliveryContext);
      setDeliveryTrackContext(deliveryContext);

      // 견적서 PNG·열람 링크·요청번호를 미리 만들어 둔다. 발송은 고객이 이 요청번호를
      // 카카오 채널로 보낸 뒤 채널톡 웹훅이 시작한다 — 상담이 먼저 열리게 하려는 것이다.
      const requestCode = await prepareQuoteDelivery(savedQuote);

      // 요청번호를 받았다면 상담전환톡이 이미 카카오톡으로 나갔다. 고객은 그 메시지의
      // 버튼만 누르면 되므로 붙여넣을 것이 없다 — 복사·대화창 열기를 하면 지시가 두
      // 개가 되어 무엇을 해야 하는지 알 수 없게 된다.
      if (requestCode) {
        setDeliveryGuideVariant("alimtalk");
        setDeliveryRequestMessage("");
        setDeliveryGuideOpen(true);
        setDeliverSuccess(true);
        return;
      }
      setDeliveryGuideVariant("paste");

      // 채널 대화창은 메시지 프리필이 불가하므로, 견적 정보가 담긴 요청 메시지를
      // 클립보드에 복사해 고객이 대화창에 붙여넣고 보내도록 유도한다(상담사가 견적 파악).
      const requestSubject = [vehicleName, quoteResult.trimName].filter(Boolean).join(" ");
      const deliveryMessage =
        `[견적서 요청] ${requestSubject}\n` +
        `${productTypeLabel(contractCategory)} · ${quoteResult.contractMonths}개월 · 연 ${quoteResult.annualMileage.toLocaleString()}km\n` +
        (requestCode ? `${REQUEST_CODE_LABEL} ${requestCode}\n` : "") +
        `견적서 보내주세요.`;
      try {
        await navigator.clipboard?.writeText(deliveryMessage);
      } catch {
        // 클립보드 권한/미지원 — 모달 CTA 클릭 시 한 번 더 복사한다.
      }

      setDeliveryRequestMessage(deliveryMessage);
      setDeliveryGuideOpen(true);
    } catch (deliverError) {
      setDeliveryError(
        deliverError instanceof Error
          ? deliverError.message
          : "견적서 요청 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      );
    } finally {
      setIsDelivering(false);
    }
  }

  /**
   * 대기 모드에서 발급되는 요청번호를 받아온다. 이 번호가 있어야 고객이 보낸 메시지와
   * 견적서를 이을 수 있다. 대기 모드가 꺼져 있으면 서버가 번호를 주지 않으므로,
   * 기존처럼 상담사가 수동으로 보내는 흐름 그대로 진행한다.
   */
  async function prepareQuoteDelivery(savedQuote: {
    id: string;
    sessionId: string;
  }): Promise<string | null> {
    try {
      const response = await fetch("/api/quote/deliver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedQuoteId: savedQuote.id,
          sessionId: savedQuote.sessionId,
        }),
      });
      // 404 는 대기 모드가 꺼져 있다는 뜻이라 기존 붙여넣기 흐름으로 이어간다.
      // 그 밖의 실패는 상담전환톡이 나가지 못한 것이므로 조용히 넘기면 안 된다 —
      // 고객은 카카오톡을 열어봐도 아무것도 받지 못한 채 기다리게 된다.
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error("카카오톡 전송에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
      const payload: unknown = await response.json().catch(() => null);
      const parsed = quotePreparedSchema.safeParse(payload);
      return parsed.success ? (parsed.data.data.requestCode ?? null) : null;
    } catch (prepareError) {
      if (!(prepareError instanceof Error)) throw prepareError;
      console.error("[quote] 견적서 준비 실패:", prepareError);
      throw prepareError;
    }
  }

  // 세션 조회 실패는 "로그인 안 됨"으로 간주한다 — 인증 오류가 게이트를 뚫으면 안 된다.
  async function hasActiveSession(): Promise<boolean> {
    try {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      return Boolean(user);
    } catch (sessionError) {
      if (!(sessionError instanceof Error)) throw sessionError;
      return false;
    }
  }

  // 로그인 게이트 CTA — 견적 상태를 보관하고, 복귀 후 이어갈 표식과 함께 카카오 로그인으로.
  async function handleDeliveryLoginGateConfirm() {
    // 클릭 자체가 의도 신호 — 로그인 시작 성공 여부와 무관하게 기록한다.
    void track("delivery_gate_login_click", {
      sessionId: quoteSessionId,
      vehicleId: selectedVehicle?.id,
      metadata: { vehicleSlug: selectedVehicle?.slug },
    });
    // OAuth 왕복 뒤에도 같은 견적 세션으로 이어지도록 보관해 둔다.
    window.localStorage.setItem(DELIVERY_GATE_SESSION_KEY, quoteSessionId);
    const state = buildRestoreState();
    if (state) {
      restoreRef.current = state;
      saveQuoteImageRestore(state);
    }
    setLoginGate(null);
    const params = new URLSearchParams(window.location.search);
    params.set("restore", "1");
    params.set(DELIVERY_RESUME_PARAM, "1");
    // 게이트 CTA 도 사용자 제스처 — 돌아올 자동 재개 1회분을 허용한다.
    grantAutoDeliveryResume();
    try {
      await startKakaoLogin({ next: `${window.location.pathname}?${params.toString()}` });
    } catch (loginError) {
      if (!(loginError instanceof Error)) throw loginError;
      setDeliveryError("로그인을 시작하지 못했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  // 안내 모달 CTA — 클릭 직후 동기적으로 대화창을 열어야 팝업 차단에 안 걸린다.
  function handleDeliveryGuideConfirm() {
    if (!openChannelChatWithMessage()) return;
    setDeliveryGuideOpen(false);
    setDeliverSuccess(true);
  }

  // '보냈어요' — 고객 자가 확인. 상담사 데스크에도 남겨 미전송 건과 구분되게 한다.
  function handleConfirmChannelSent() {
    setDeliveryConfirmedBySender(true);
    if (deliveryTrackContext) trackQuoteDeliverySent(deliveryTrackContext);
  }

  // '대화창 다시 열기' — 창을 닫았거나 붙여넣기를 놓친 고객이 되돌아갈 길.
  function handleReopenChannelChat() {
    openChannelChatWithMessage();
  }

  // 요청 문구를 다시 복사하고 대화창을 연다. 클릭 핸들러에서 동기 호출해야 팝업 차단을 피한다.
  function openChannelChatWithMessage(): boolean {
    const chatUrl = kakaoChannelChatUrl();
    if (!chatUrl) {
      setDeliveryGuideOpen(false);
      setDeliveryError("카카오 채널 설정을 확인해 주세요. 잠시 후 다시 시도해주세요.");
      return false;
    }
    // 앞선 복사의 사용자 활성화가 만료됐을 수 있어(Safari 등) 새 제스처에서 한 번 더 복사.
    if (deliveryRequestMessage) {
      try {
        navigator.clipboard?.writeText(deliveryRequestMessage).catch(() => {});
      } catch {
        // 복사 실패해도 대화창은 연다.
      }
    }
    window.open(chatUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  async function refreshQuoteForDelivery(): Promise<QuoteResponse> {
    const baseQuote = await requestCalculatedQuoteForDelivery({
      depositRate: 0,
      prepayRate: 0,
    });
    baseStandardScenario.current = baseQuote.scenarios.standard;

    const refreshedQuote =
      customRates.depositRate > 0 || customRates.prepayRate > 0
        ? await requestCalculatedQuoteForDelivery(customRates)
        : baseQuote;

    if (hasLockedQuoteScenario(refreshedQuote)) {
      throw new Error(
        "로그인 정보가 견적에 반영되지 않았습니다. 새로고침 후 다시 시도해 주세요."
      );
    }

    recalculateRequestId.current += 1;
    setQuoteResult(refreshedQuote);
    return refreshedQuote;
  }

  async function requestCalculatedQuoteForDelivery(rates: {
    readonly depositRate: number;
    readonly prepayRate: number;
  }): Promise<QuoteResponse> {
    if (!selectedVehicle || !quoteResult?.trimId) {
      throw new Error("전송할 견적 정보를 확인할 수 없습니다.");
    }

    const response = await fetch(
      `/api/vehicles/${selectedVehicle.slug}/quote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: quoteSessionId,
          trimId: quoteResult.trimId,
          selectedOptionIds: getEffectiveSelectedOptionIds(),
          contractMonths: quoteResult.contractMonths,
          annualMileage: quoteResult.annualMileage,
          contractType: "반납형",
          productType: contractCategory,
          customerType,
          ...getEffectiveSelectedColorIds(),
          ...(rates.depositRate > 0
            ? { customDepositRate: rates.depositRate }
            : {}),
          ...(rates.prepayRate > 0
            ? { customPrepayRate: rates.prepayRate }
            : {}),
        }),
      }
    );
    const responsePayload: unknown = await response.json().catch(() => null);
    const parsed = successfulCalculatedQuoteResponseSchema.safeParse(
      responsePayload
    );
    if (!response.ok || !parsed.success) {
      const apiErrorResult = apiErrorSchema.safeParse(responsePayload);
      throw new Error(
        apiErrorResult.success && apiErrorResult.data.error
          ? apiErrorResult.data.error
          : "로그인 후 견적을 다시 계산하지 못했습니다."
      );
    }
    return parsed.data.data;
  }

  // ─── 복원 저장본 생성 + 게이트 로그인 (v1 계약 그대로) ──
  const buildRestoreState = useCallback((): QuoteImageRestoreState | null => {
    if (!quoteResult || !selectedVehicle) return null;
    return {
      vehicleSlug: selectedVehicle.slug,
      customerType,
      selectedLineup,
      selectedTrimName: selectedTrim?.name ?? null,
      selectedOptionIds: getEffectiveSelectedOptionIds(),
      contractCategory,
      conditions: {
        contractMonths: conditions.contractMonths,
        annualMileage: conditions.annualMileage,
        contractType: "반납형",
      },
      customRates,
      ...getEffectiveSelectedColorIds(),
      costMode,
      baseStandard: baseStandardScenario.current,
      quoteResult,
    };
  }, [quoteResult, selectedVehicle, customerType, selectedLineup, selectedTrim, getEffectiveSelectedOptionIds, getEffectiveSelectedColorIds, contractCategory, conditions, customRates, costMode]);

  async function startKakaoConsentFlow(): Promise<void> {
    const state = buildRestoreState();
    if (state) {
      restoreRef.current = state;
      saveQuoteImageRestore(state);
    }
    // 게이트 로그인(handleDeliveryLoginGateConfirm)과 같은 표식을 남긴다 —
    // restore 마커가 없으면 복귀 시 저장본을 읽지 않아 1단계로 초기화되고,
    // deliver 마커가 없으면 전달 의도가 사라진다.
    window.localStorage.setItem(DELIVERY_GATE_SESSION_KEY, quoteSessionId);
    const params = new URLSearchParams(window.location.search);
    params.set("restore", "1");
    params.set(DELIVERY_RESUME_PARAM, "1");
    const next = `${window.location.pathname}?${params.toString()}`;
    await startKakaoLogin({ next });
  }

  const handleGateLogin = useCallback(() => {
    const state = buildRestoreState();
    if (state) {
      restoreRef.current = state;
      saveQuoteImageRestore(state);
    }
    const params = new URLSearchParams({
      vehicle: selectedVehicle?.slug ?? "",
      customerType,
      restore: "1",
    });
    if (draftSource === "AI") params.set("source", "AI");
    router.push(`/login?next=${encodeURIComponent(`/quote?${params.toString()}`)}`);
  }, [buildRestoreState, router, selectedVehicle, customerType, draftSource]);

  const applyLeaveQuoteResult = useCallback(() => {
    quoteResultHistoryOpenRef.current = false;
    setQuoteResult(null);
    setError(null);
    goToStep(2);
  }, [goToStep]);

  // 결과 화면의 시스템 뒤로가기·헤더 뒤로·「조건 다시 설정하기」가 모두 여기를 탄다.
  const leaveQuoteResult = useCallback(() => {
    const shouldPop =
      typeof window !== "undefined" &&
      (quoteResultHistoryOpenRef.current ||
        hasQuoteResultHistoryState(window.history.state));
    applyLeaveQuoteResult();
    if (!shouldPop) return;
    swallowResultHistoryPopRef.current = true;
    window.history.back();
    queueMicrotask(() => {
      swallowResultHistoryPopRef.current = false;
    });
  }, [applyLeaveQuoteResult]);

  // 결과(step 3) 도달 시 저장본 localStorage 저장 + restore 마커 동기화 (v1 계약)
  // 결과용 히스토리 항목을 하나 쌓아, 시스템 뒤로가기가 차량 상세로 나가지 않게 한다.
  useEffect(() => {
    if (step === 3 && quoteResult && selectedVehicle) {
      const state = buildRestoreState();
      if (state) {
        restoreRef.current = state;
        saveQuoteImageRestore(state);
      }
      if (typeof window !== "undefined") {
        syncQuoteResultHistory(selectedVehicle.slug, customerType);
        quoteResultHistoryOpenRef.current = true;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, quoteResult, costMode, customRates]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      if (swallowResultHistoryPopRef.current) {
        swallowResultHistoryPopRef.current = false;
        event.stopImmediatePropagation();
        return;
      }
      if (stepRef.current !== 3 || !quoteResultHistoryOpenRef.current) return;
      // Next.js 가 이 popstate 를 문서 이동으로 처리하지 않게 가로챈다.
      event.stopImmediatePropagation();
      applyLeaveQuoteResult();
    };
    window.addEventListener("popstate", onPopState, true);
    return () => window.removeEventListener("popstate", onPopState, true);
  }, [applyLeaveQuoteResult]);

  // ─── 로그인 게이트 복귀 → 견적서 요청 흐름 1회 자동 재개 ─────
  // 대화창은 여기서 열지 않는다. 페이지 로드 직후의 window.open 은 팝업 차단에 걸리므로,
  // 안내 모달까지만 띄우고 대화창은 모달 CTA(사용자 제스처)로 연다.
  const deliveryResumeHandled = useRef(false);
  useEffect(() => {
    // 카카오 자동발송 레인도 같은 표식으로 돌아온다 — 여기서 조기 반환하면
    // 왕복 복귀가 전달 의도 없이 결과 화면에만 머문다.
    if (!isDeliveryResumeReturn) return;
    if (deliveryResumeHandled.current) return;
    if (step !== 3 || !quoteResult) return;
    deliveryResumeHandled.current = true;

    // 표식 제거 — 새로고침으로 다시 실행되지 않게 한다.
    // 결과 히스토리 마커는 유지한다. 지워지면 헤더 뒤로가기가 차량 상세로 나간다.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      params.delete(DELIVERY_RESUME_PARAM);
      window.history.replaceState(
        quoteResultHistoryState(window.history.state),
        "",
        `/quote?${params.toString()}`,
      );
    }

    // 자동 재개 1회 예산 — 소진됐다면 이 왕복은 사용자 의도로 보지 않는다.
    // OAuth 왕복은 페이지 이동이라 useRef 는 회차마다 초기화되므로 여기서 막는다.
    if (!consumeAutoDeliveryResume()) return;

    void (async () => {
      // 로그인이 끝나지 않았다면 조용히 넘어간다. 버튼을 다시 누르면 게이트가 다시 뜬다.
      if (!(await hasActiveSession())) return;
      await (channelTalkDelivery
        ? handleQuoteReceiveViaChannelTalk()
        : deliverQuoteToKakao(true));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelTalkDelivery, isDeliveryResumeReturn, step, quoteResult]);

  // quoteSessionId 는 3회차(견적 초안 저장)에서 사용.
  void quoteSessionId;

  // ─── v2 톤 TrimDataV2 변환 ─────────────────────────────
  const selectedTrimV2: TrimDataV2 | null = selectedTrim
    ? {
        id: selectedTrim.id,
        name: selectedTrim.name,
        price: selectedTrim.price,
        discountPrice: selectedTrim.discountPrice,
        engineType: selectedTrim.engineType,
        fuelEfficiency: selectedTrim.fuelEfficiency,
        options: selectedTrim.options.map((o) => ({
          id: o.id,
          name: o.name,
          price: o.price,
          category: o.category,
          description: o.description,
          badge: o.badge,
        })),
        rules: selectedTrim.rules.map((r) => ({
          ruleType: r.ruleType,
          sourceOptionId: r.sourceOptionId,
          targetOptionId: r.targetOptionId,
        })),
        availableProducts: selectedTrim.availableProducts,
      }
    : null;

  const stepLabel = STEPS[step - 1];

  return (
    <div
      className={
        step === 3
          ? "min-h-screen bg-app-bg"
          : "min-h-screen bg-app-bg pb-[calc(164px+env(safe-area-inset-bottom,0px))] md:pb-0"
      }
    >
      <header className="sticky top-14 z-40 border-b border-border-subtle bg-surface/95 backdrop-blur-md md:hidden">
        <div className="flex h-14 items-center gap-3 px-5 max-[340px]:px-3">
          <button
            type="button"
            onClick={() => {
              if (step === 3) {
                leaveQuoteResult();
                return;
              }
              // 딥링크/공유로 직접 진입한 경우(history 없음) router.back()이 사이트를 떠나지 않도록 폴백.
              const fallback = selectedVehicle
                ? `/cars/${selectedVehicle.slug}`
                : "/cars";
              if (typeof window !== "undefined" && window.history.length > 1) {
                router.back();
              } else {
                router.push(fallback);
              }
            }}
            aria-label="뒤로"
            className="flex h-11 w-11 items-center justify-center rounded-full text-text-strong transition-colors hover:bg-surface-soft"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-bold leading-tight text-text-strong">{stepLabel}</p>
          </div>
          <span className="num text-[13px] font-bold text-brand tabular-nums">
            {step}<span className="text-text-muted">/{STEPS.length}</span>
          </span>
        </div>
        <div className="h-[2px] bg-border-subtle">
          <motion.div
            className="h-full bg-brand"
            initial={false}
            animate={{ width: `${(step / STEPS.length) * 100}%` }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          />
        </div>
      </header>

      {/* 데스크톱 헤더 */}
      <div className="hidden border-b border-border-subtle bg-surface md:block">
        <div className="mx-auto max-w-[680px] px-8 py-10">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1.5 text-[12px] font-bold text-brand">
            실시간 견적
          </div>
          <h1 className="text-[32px] font-extrabold leading-[1.2] tracking-[-0.03em] text-text-strong">
            {stepLabel}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-text-body">
            보증금·선납금 없이 시작하거나, 초기 비용으로 월 납입금을 낮춰보세요.
          </p>
        </div>
      </div>

      {/* 본문 */}
      <main className="mx-auto max-w-[680px] px-5 py-8 max-[340px]:px-4 md:px-8 md:py-10">
        {restoreSnapshotMissing && step !== 3 && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-[14px] border border-status-warning/25 bg-status-warning-soft px-4 py-3"
          >
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-status-warning" />
            <p className="break-keep text-[12.5px] font-medium leading-relaxed text-status-warning">
              이전 견적 정보를 불러오지 못했어요. 조건을 다시 선택하면 바로 견적을 확인할 수 있어요.
            </p>
          </div>
        )}
        {prefillFallbackNotice && step === 2 && (
          <div
            role="status"
            className="mb-4 flex items-start gap-2 rounded-[14px] border border-status-warning/25 bg-status-warning-soft px-4 py-3"
          >
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-status-warning" />
            <p className="break-keep text-[12.5px] font-medium leading-relaxed text-status-warning">
              {prefillFallbackNotice}
            </p>
          </div>
        )}
        <AnimatePresence mode="wait">
          {step === 1 && (
            <Step1CustomerType
              key="step1"
              customerType={customerType}
              onSelect={setCustomerType}
              onNext={() => goToStep(2)}
            />
          )}
          {step === 2 && (
            <Step2ConditionV2
              key="step2"
              hasCascade={hasCascade}
              lineupChoices={lineupChoices}
              selectedLineup={selectedLineup}
              onLineupChange={(lineup) => {
                setSelectedLineup(lineup);
                setSelectedOptionIds(new Set());
              }}
              cascadeTrimChoices={cascadeTrimChoices}
              flatTrimChoices={flatTrimChoices}
              selectedTrimId={selectedTrimId}
              onTrimChange={(trimId) => {
                if (hasCascade) {
                  setSelectedTrimId(trimId);
                } else {
                  setSelectedLineup(trimId);
                }
                setSelectedOptionIds(new Set());
              }}
              selectedTrim={selectedTrimV2}
              trimsLoading={trimsLoading}
              trimsError={trimsError}
              onRetryLoadTrims={loadVehicleDetails}
              canRequestConsultation={canRequestConsultation}
              selectedOptionIds={selectedOptionIds}
              onOptionToggle={handleOptionToggle}
              optionsTotalPrice={optionsTotalPrice}
              selectedOptionDetails={selectedOptionDetails}
              colors={colors}
              colorsError={colorsError}
              onRetryLoadColors={retryLoadColors}
              exteriorColorId={exteriorColorId}
              interiorColorId={interiorColorId}
              onColorChange={(kind, id) => {
                if (kind === "EXTERIOR") setExteriorColorId(id);
                else setInteriorColorId(id);
              }}
              colorDelta={colorDelta}
              contractCategory={contractCategory}
              onContractCategoryChange={setContractCategory}
              contractMonths={conditions.contractMonths}
              onContractMonthsChange={(m) => setConditions((p) => ({ ...p, contractMonths: m }))}
              annualMileage={conditions.annualMileage}
              onAnnualMileageChange={(m) => setConditions((p) => ({ ...p, annualMileage: m }))}
              onPrev={() => goToStep(1)}
              onCalculate={fetchQuote}
              isLoading={isLoading}
              error={error}
            />
          )}
          {step === 3 && quoteResult && (
            <Step3ResultHeader
              key="step3"
              quoteResult={quoteResult}
              selectedVehicle={selectedVehicle}
              customerType={customerType}
              contractCategory={contractCategory}
              selectedOptionDetails={selectedOptionDetails}
              selectedExteriorColor={selectedExteriorColor}
              selectedInteriorColor={selectedInteriorColor}
              selectedTrim={selectedTrim}
              trims={trims}
              vehicles={vehicles}
              conditions={conditions}
              selectedOptionIds={selectedOptionIds}
              customRates={customRates}
              costMode={costMode}
              isRecalculating={isRecalculating}
              recalculationError={recalculationError}
              onRecalculationRetry={() => {
                void recalculateStandardRef.current(customRates).catch(() => {});
              }}
              isConsultationSubmitting={isConsultationSubmitting}
              consultationError={consultationError}
              kakaoDeliveryEnabled={kakaoDeliveryEnabled}
              channelTalkDelivery={channelTalkDelivery}
              isDelivering={isDelivering}
              deliverSuccess={deliverSuccess}
              deliveryError={deliveryError}
              onQuoteDeliver={
                kakaoDeliveryEnabled
                  ? handleQuoteDeliver
                  : handleQuoteReceiveViaChannelTalk
              }
              onReopenChannelChat={handleReopenChannelChat}
              onConfirmChannelSent={handleConfirmChannelSent}
              deliveryConfirmedBySender={deliveryConfirmedBySender}
              alimtalkDelivery={deliveryGuideVariant === "alimtalk"}
              onCustomRatesChange={setCustomRates}
              onCostModeChange={setCostMode}
              onReset={restoreBaseStandardScenario}
              onMemberLogin={() => setLoginGate("initialCost")}
              onComparisonLogin={handleGateLogin}
              onConsultationRequest={handleConsultationRequest}
              onPrev={leaveQuoteResult}
            />
          )}
          {step === 3 && !quoteResult && (
            <motion.div
              key="step3-restoring"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center gap-3 py-20"
            >
              <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
              <p className="text-[13px] text-text-body">견적 정보를 불러오는 중…</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* 초기비용 변경 게이트 — 혜택 소구형 마케팅 모달 */}
      <LoginBenefitsModal
        open={loginGate === "initialCost"}
        onClose={() => setLoginGate(null)}
        onKakaoLogin={handleGateLogin}
        onConsultation={() => {
          setLoginGate(null);
          void handleConsultationRequest();
        }}
      />

      {/* 견적서 수령 게이트 — 견적서 발송 약속형 마케팅 모달 */}
      <QuoteDeliveryLoginModal
        open={loginGate === "delivery"}
        onClose={() => setLoginGate(null)}
        onKakaoLogin={() => void handleDeliveryLoginGateConfirm()}
      />

      <QuoteDeliveryGuideModal
        open={deliveryGuideOpen}
        message={deliveryRequestMessage ?? ""}
        variant={deliveryGuideVariant}
        onClose={() => setDeliveryGuideOpen(false)}
        onConfirm={handleDeliveryGuideConfirm}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// STEP 1 — 고객 유형 (1회차와 동일)
// ════════════════════════════════════════════════════════════
function Step1CustomerType({
  customerType,
  onSelect,
  onNext,
}: {
  customerType: CustomerType;
  onSelect: (t: CustomerType) => void;
  onNext: () => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ duration: 0.22 }}
      className="space-y-8"
    >
      <div>
        <h2 className="text-[24px] font-extrabold leading-[1.3] tracking-[-0.03em] text-text-strong md:text-[28px]">
          누구 명의로
          <br />
          계약하시나요?
        </h2>
        <p className="mt-3 break-keep text-[15px] leading-relaxed text-text-body">
          선택한 유형은 견적 저장과 계약 신청 서류 확인에 사용돼요.
        </p>
      </div>

      <div className="space-y-3">
        {CUSTOMER_TYPE_OPTIONS.map((option) => {
          const selected = customerType === option.type;
          return (
            <button
              key={option.type}
              type="button"
              onClick={() => onSelect(option.type)}
              className={cn(
                "flex w-full items-center gap-4 rounded-[20px] px-5 py-5 text-left transition-all duration-200 max-[340px]:gap-3 max-[340px]:px-4 md:px-6 md:py-6",
                selected
                  ? "bg-brand-soft ring-[1.5px] ring-brand"
                  : "bg-surface-soft ring-[1.5px] ring-transparent hover:ring-border-subtle"
              )}
            >
              <span
                className={cn(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] transition-colors",
                  selected ? "bg-brand text-[var(--color-brand-ink)]" : "bg-surface text-text-body"
                )}
              >
                {option.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold leading-tight text-text-strong md:text-[18px]">
                  {option.title}
                </span>
                <span className="mt-1 block break-keep text-[13.5px] leading-snug text-text-body">
                  {option.desc}
                </span>
              </span>
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-all",
                  selected ? "bg-brand text-[var(--color-brand-ink)]" : "bg-border-subtle text-transparent"
                )}
              >
                <Check size={14} strokeWidth={2.6} />
              </span>
            </button>
          );
        })}
      </div>

      <FixedCTA onClick={onNext} label="다음" icon={<ArrowRight size={16} strokeWidth={2.4} />} />
    </motion.section>
  );
}

// ════════════════════════════════════════════════════════════
// STEP 3 — 결과 (2회차: 실제 API 연동)
// ════════════════════════════════════════════════════════════
function Step3ResultHeader({
  quoteResult,
  selectedVehicle,
  customerType,
  contractCategory,
  selectedOptionDetails,
  selectedExteriorColor,
  selectedInteriorColor,
  selectedTrim,
  trims,
  vehicles,
  conditions,
  selectedOptionIds,
  customRates,
  costMode,
  isRecalculating,
  recalculationError,
  onRecalculationRetry,
  isConsultationSubmitting,
  consultationError,
  kakaoDeliveryEnabled,
  channelTalkDelivery,
  isDelivering,
  deliverSuccess,
  deliveryError,
  onQuoteDeliver,
  onReopenChannelChat,
  onConfirmChannelSent,
  deliveryConfirmedBySender,
  alimtalkDelivery,
  onCustomRatesChange,
  onCostModeChange,
  onReset,
  onMemberLogin,
  onComparisonLogin,
  onConsultationRequest,
  onPrev,
}: {
  quoteResult: QuoteResponse;
  selectedVehicle: VehicleListItem | null;
  customerType: CustomerType;
  contractCategory: "장기렌트" | "리스";
  selectedOptionDetails: { id: string; name: string; price: number }[];
  selectedExteriorColor: { name: string; hexCode: string; priceDelta: number } | null;
  selectedInteriorColor: { name: string; hexCode: string; priceDelta: number } | null;
  selectedTrim: { id: string; name: string; price: number; discountPrice: number | null; evSubsidy: number | null } | null;
  trims: { id: string; name: string; price: number; discountPrice: number | null }[];
  vehicles: VehicleListItem[];
  conditions: { contractMonths: number; annualMileage: number };
  selectedOptionIds: Set<string>;
  customRates: { depositRate: number; prepayRate: number };
  costMode: CostMode;
  isRecalculating: boolean;
  recalculationError: string | null;
  onRecalculationRetry: () => void;
  isConsultationSubmitting: boolean;
  consultationError: string | null;
  kakaoDeliveryEnabled: boolean;
  channelTalkDelivery: boolean;
  isDelivering: boolean;
  deliverSuccess: boolean;
  deliveryError: string | null;
  onQuoteDeliver: () => void;
  onReopenChannelChat: () => void;
  onConfirmChannelSent: () => void;
  deliveryConfirmedBySender: boolean;
  alimtalkDelivery: boolean;
  onCustomRatesChange: (rates: { depositRate: number; prepayRate: number }) => void;
  onCostModeChange: (mode: CostMode) => void;
  onReset: () => void;
  onMemberLogin: () => void;
  onComparisonLogin: () => void;
  onConsultationRequest: () => void;
  onPrev: () => void;
}) {
  const standardScenario: QuoteScenarioDetail | undefined = resolveQuoteResultScenario(
    quoteResult.scenarios,
    customRates,
  );
  const totalVehiclePrice =
    quoteResult.totalVehiclePrice ??
    quoteResult.trimPrice + (quoteResult.optionsTotalPrice ?? 0);
  // 타 업체 평균 비교값 — 표시 전용. 실제 시장 데이터가 아니라 현재 월 납입금에 구간별 가산 적용.
  const competitorMonthlyPayment =
    standardScenario?.monthlyPayment != null && standardScenario.monthlyPayment > 0
      ? Math.round(
          standardScenario.monthlyPayment * (1 + competitorMarkupRate(standardScenario.monthlyPayment)),
        )
      : null;
  // 시나리오가 아예 없으면(자동 견적 불가) 별도 상담. 시나리오는 있는데 표시 가능한
  // 공개 금액이 없으면(전부 잠김) 상담이 아니라 로그인 안내를 그린다 — 0원 배너 금지.
  const hasAnyScenario = Boolean(
    quoteResult.scenarios &&
      (quoteResult.scenarios.conservative ||
        quoteResult.scenarios.standard ||
        quoteResult.scenarios.aggressive),
  );
  const isConsultationResult =
    quoteResult.requiresConsultation === true || !hasAnyScenario;
  const showDeliveryBar =
    !isConsultationResult &&
    hasQuoteResultDelivery({ kakaoDeliveryEnabled, channelTalkDelivery });
  const deliveryBarProps = {
    kakaoDeliveryEnabled,
    channelTalkDelivery,
    isDelivering,
    deliverySuccess: deliverSuccess,
    deliveryError,
    onQuoteDeliver,
    onReopenChannelChat,
    onConfirmChannelSent,
    deliveryConfirmedBySender,
    alimtalkDelivery,
  };

  return (
    <>
      <motion.section
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -16 }}
        transition={{ duration: 0.22 }}
        className={cn(
          "space-y-5",
          showDeliveryBar && "pb-[calc(16rem+env(safe-area-inset-bottom,0px))]",
        )}
      >
      {/* ── 1) 차량 정보 카드 ── */}
      <div className="overflow-hidden rounded-[24px] border border-border-subtle bg-surface shadow-soft">
        {/* 상단: 이미지(가로 절반) + 차량명 */}
        <div className="flex items-stretch gap-3 p-4 md:gap-4 md:p-5">
          <div className="relative aspect-[4/3] w-1/2 shrink-0 overflow-hidden rounded-[16px] bg-surface-soft">
            {selectedVehicle?.thumbnailUrl ? (
              <Image
                src={selectedVehicle.thumbnailUrl}
                alt={selectedVehicle.name ?? "차량"}
                fill
                sizes="(max-width: 768px) 50vw, 280px"
                unoptimized={isSupabaseStorageUrl(selectedVehicle.thumbnailUrl)}
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[12px] text-text-muted">
                이미지 없음
              </div>
            )}
          </div>
          <div className="flex min-w-0 w-1/2 flex-col justify-center py-0.5">
            <p className="text-[12.5px] font-bold uppercase tracking-[0.08em] text-text-muted">
              {selectedVehicle?.brand}
            </p>
            <p className="mt-1 text-[19px] font-extrabold leading-snug text-text-strong sm:text-[21px]">
              {selectedVehicle?.name}
            </p>
            {quoteResult.trimName && (
              <p className="mt-1.5 text-[14px] font-medium leading-snug text-text-body">
                {quoteResult.trimName}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 px-4 pb-4 md:px-5 md:pb-5">
          {/* 선택한 구성 — 별도 패널로 시각 구분 */}
          <div className="rounded-[16px] bg-surface-soft p-3.5 md:p-4">
            <p className="text-[12.5px] font-extrabold uppercase tracking-[0.07em] text-text-muted">
              선택한 구성
            </p>
            {selectedOptionDetails.length > 0 || selectedExteriorColor || selectedInteriorColor ? (
              <div className="mt-2.5 space-y-2.5">
                {selectedOptionDetails.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedOptionDetails.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center rounded-full bg-surface px-2.5 py-1 text-[13px] font-bold text-text-body ring-1 ring-border-subtle"
                      >
                        {o.name}
                      </span>
                    ))}
                  </div>
                )}
                {(selectedExteriorColor || selectedInteriorColor) && (
                  <div className="flex flex-col gap-2 text-[14px] sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5 sm:gap-y-2">
                    {selectedExteriorColor && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-text-muted">외장</span>
                        <span
                          aria-hidden
                          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: selectedExteriorColor.hexCode }}
                          title={selectedExteriorColor.hexCode}
                        />
                        <span className="font-bold text-text-strong">{selectedExteriorColor.name}</span>
                      </span>
                    )}
                    {selectedInteriorColor && (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-text-muted">내장</span>
                        <span
                          aria-hidden
                          className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: selectedInteriorColor.hexCode }}
                          title={selectedInteriorColor.hexCode}
                        />
                        <span className="font-bold text-text-strong">{selectedInteriorColor.name}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[14px] font-medium text-text-body">기본 사양</p>
            )}
          </div>

          {/* 상품 / 계약기간 / 약정거리 — 카드형 3분할 */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-[14px] bg-surface-soft px-2.5 py-3 text-center">
              <p className="text-[12px] font-bold text-text-muted">상품</p>
              <p className="mt-1 text-[14.5px] font-extrabold leading-tight text-text-strong sm:text-[15px]">
                {productTypeLabel(contractCategory)}
              </p>
            </div>
            <div className="rounded-[14px] bg-surface-soft px-2.5 py-3 text-center">
              <p className="text-[12px] font-bold text-text-muted">계약기간</p>
              <p className="num mt-1 text-[14.5px] font-extrabold leading-tight tabular-nums text-text-strong sm:text-[15px]">
                {quoteResult.contractMonths}개월
              </p>
            </div>
            <div className="rounded-[14px] bg-surface-soft px-2.5 py-3 text-center">
              <p className="text-[12px] font-bold text-text-muted">약정거리</p>
              <p className="num mt-1 text-[14.5px] font-extrabold leading-tight tabular-nums text-text-strong sm:text-[15px]">
                연 {(quoteResult.annualMileage / 10000).toFixed(0)}만km
              </p>
            </div>
          </div>

          {/* 총 차량가 — 강조 블록 */}
          <div className="flex items-center justify-between gap-3 rounded-[16px] bg-brand-soft/70 px-4 py-3.5 ring-1 ring-brand/15">
            <div className="min-w-0">
              <p className="text-[12.5px] font-extrabold uppercase tracking-[0.06em] text-brand">
                총 차량가
              </p>
              <p className="mt-0.5 text-[12.5px] font-medium text-text-muted">
                {quoteResult.trimName ? "트림 + 옵션 포함" : "기준 차량가격"}
              </p>
            </div>
            <p className="num shrink-0 text-[26px] font-extrabold tabular-nums leading-none text-brand sm:text-[28px]">
              {Math.round(totalVehiclePrice / 10_000).toLocaleString()}
              <span className="ml-0.5 text-[15px] font-bold">만원</span>
            </p>
          </div>
        </div>
      </div>

      {isConsultationResult ? (
        <>
          <div className="rounded-[24px] bg-brand p-6 text-[var(--color-brand-ink)] md:p-7">
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-ink)]">월 납입금</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[30px] font-extrabold leading-tight text-[var(--color-brand-ink)] sm:text-[36px]">
                  별도 상담 필요
                </p>
                <p className="mt-2 text-[14px] font-bold text-[var(--color-brand-ink)]">
                  이 차량은 별도 상담이 필요합니다
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11.5px] font-bold text-[var(--color-brand-ink)]">
                <AlertCircle size={12} />
                견적 준비중
              </span>
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed text-[var(--color-brand-ink)]">
              현재 자동 견적에 필요한 데이터가 등록되지 않아 정확한 월 납입금을 즉시 산출하기 어렵습니다.
              선택하신 조건 기준으로 상담을 통해 맞춤 견적을 안내해드릴게요.
            </p>
            <ChannelTalkButton
              vehicleName={selectedVehicle?.name}
              label="선택 조건으로 상담 요청하기"
              onClick={onConsultationRequest}
              loading={isConsultationSubmitting}
              className="mt-5 h-[48px] rounded-[14px] bg-white px-4 text-[14px] font-bold text-[var(--color-channeltalk-action)] hover:bg-white/95"
            />
            {consultationError && (
              <p role="alert" className="mt-3 rounded-[10px] bg-white/10 px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-brand-ink)]">
                {consultationError}
              </p>
            )}
          </div>

          <div className="rounded-[16px] bg-surface-soft p-4 text-[12px] leading-relaxed text-text-muted">
            옵션·계약조건에 따라 캐피탈사별 금액이 크게 달라질 수 있어 상담을 통한 견적이 더 정확합니다.
          </div>

          <button
            type="button"
            onClick={onPrev}
            className="mx-auto flex items-center gap-1 text-[13px] font-bold text-text-muted transition-colors hover:text-text-strong"
          >
            <ChevronLeft size={14} />
            조건 다시 설정하기
          </button>
        </>
      ) : !isDisplayableQuoteScenario(standardScenario) ? (
        <>
          {/* ── 2-잠금) 표시 가능한 공개 금액이 없다 — 0원 배너 대신 로그인 안내 ── */}
          <div className="rounded-[24px] bg-brand p-6 text-[var(--color-brand-ink)] md:p-7">
            <p className="text-[13px] font-bold uppercase tracking-[0.08em] text-[var(--color-brand-ink)]">
              월 납입금
            </p>
            <p className="mt-3 break-keep text-[24px] font-extrabold leading-[1.3] text-[var(--color-brand-ink)] sm:text-[28px]">
              로그인하면 이 조건 월납 확인
            </p>
            <p className="mt-2 break-keep text-[13.5px] leading-relaxed text-[var(--color-brand-ink)]">
              회원 전용 조건이에요. 로그인하면 이 조건의 월 납입금을 바로 확인할 수 있어요.
            </p>
            <button
              type="button"
              onClick={onMemberLogin}
              className="mt-5 flex h-[48px] w-full items-center justify-center rounded-[14px] bg-white px-4 text-[14px] font-bold text-brand transition-colors hover:bg-white/95"
            >
              로그인하고 월 납입금 보기
            </button>
          </div>

          <button
            type="button"
            onClick={onPrev}
            className="mx-auto flex items-center gap-1 text-[13px] font-bold text-text-muted transition-colors hover:text-text-strong"
          >
            <ChevronLeft size={14} />
            조건 다시 설정하기
          </button>
        </>
      ) : (
        <>
          {/* ── 2) 월 납입금 대형 강조 (실제 데이터) — 좌: 아임딜러 / 우: 타 업체 평균 비교 ── */}
          <div>
            <div className="grid grid-cols-[3fr_2fr] overflow-hidden rounded-[24px]">
              {/* 왼쪽: 아임딜러 최저가 — 기존 파랑 유지 */}
              <div className="flex min-w-0 flex-col bg-brand p-4 text-[var(--color-brand-ink)] sm:p-5 md:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--color-brand-ink)] sm:text-[13px]">
                    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-white/20">
                      <Check size={11} strokeWidth={3} />
                    </span>
                    아임딜러 최저가
                  </p>
                  {isRecalculating && (
                    <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-brand-ink)]">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[rgb(var(--color-brand-ink-rgb)/0.35)] border-t-[var(--color-brand-ink)]" />
                      재계산 중…
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex items-baseline gap-1">
                  <span className="text-[14px] font-bold text-[var(--color-brand-ink)] md:text-[15px]">월</span>
                  <TossPrice won={standardScenario.monthlyPayment} size="card" tone="onBrand" />
                </div>
                <p className="mt-2 text-[12px] font-medium text-[rgb(var(--color-brand-ink-rgb)/0.85)] sm:text-[12.5px]">
                  {[
                    standardScenario.bestFinanceCompany,
                    `${quoteResult.contractMonths}개월`,
                    `연 ${(quoteResult.annualMileage / 10000).toFixed(0)}만km`,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
              {/* 오른쪽: 타 업체 평균 — 차분한 회색 톤·취소선 (표시 전용 구간별 가산) */}
              <div className="flex min-w-0 flex-col justify-center bg-[#F1F0EC] p-4 sm:p-5 md:p-6">
                <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#8A857C] sm:text-[12.5px]">
                  <Users size={12} />
                  타 업체 평균
                </p>
                <p className="mt-2.5 flex items-baseline gap-0.5 text-[#6E6A61] line-through decoration-[#6E6A61]/40">
                  <span className="text-[11.5px] font-medium">월</span>
                  <span className="text-[18px] font-semibold leading-none tabular-nums sm:text-[20px] md:text-[22px]">
                    {competitorMonthlyPayment?.toLocaleString("ko-KR")}
                  </span>
                  <span className="text-[11.5px] font-medium">원</span>
                </p>
                <p className="mt-2 text-[11.5px] font-medium text-[#8A857C] sm:text-[12px]">
                  전국 딜러사 평균 견적
                </p>
              </div>
            </div>

            {/* ── 2-0) 재계산 실패 안내 — 표시 금액이 새 조건이 아님을 알리고 재시도를 준다 ── */}
            {recalculationError && (
              <div
                role="alert"
                className="mt-2 flex items-start gap-2 rounded-[14px] border border-status-warning/25 bg-status-warning-soft px-4 py-3"
              >
                <AlertCircle size={13} className="mt-0.5 shrink-0 text-status-warning" />
                <div className="min-w-0">
                  <p className="break-keep text-[12.5px] font-medium leading-relaxed text-status-warning">
                    {recalculationError}
                  </p>
                  <button
                    type="button"
                    onClick={onRecalculationRetry}
                    className="mt-1.5 text-[12.5px] font-bold text-status-warning underline underline-offset-2"
                  >
                    다시 계산하기
                  </button>
                </div>
              </div>
            )}

            {/* ── 2-1) 절약액 배너 — 타 업체 평균 대비 월 절약액 ── */}
            {competitorMonthlyPayment != null && (
              <div className="mt-2 flex items-center gap-2 rounded-[14px] bg-status-positive-soft px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-status-positive">
                  <BadgePercent size={13} strokeWidth={2.4} className="text-white" />
                </span>
                <p className="text-[12.5px] font-medium text-status-positive sm:text-[13px]">
                  전국 딜러사 평균 견적보다{" "}
                  <span className="num font-extrabold tabular-nums">
                    월 {(competitorMonthlyPayment - standardScenario.monthlyPayment).toLocaleString("ko-KR")}원
                  </span>{" "}
                  더 저렴합니다
                </p>
              </div>
            )}
          </div>

          {/* ── 3) 초기비용(보증금/선납금) 패널 ── */}
          <InitialCostPanelV2
            data={standardScenario}
            customRates={customRates}
            onCustomRatesChange={onCustomRatesChange}
            isRecalculating={isRecalculating}
            costMode={costMode}
            onCostModeChange={onCostModeChange}
            onMemberLogin={onMemberLogin}
            onReset={onReset}
          />

          {/* ── 4) EV 보조금 안내 (견적 미반영, 표시 전용) ── */}
          {selectedTrim?.evSubsidy ? (
            <EvSubsidyNotice amount={selectedTrim.evSubsidy} />
          ) : null}

          {/* ── 5) 심사 가능성 미리보기 ── */}
          <ApprovalPreviewV2 data={standardScenario} />

          {/* ── 6) 금융사별 견적 ── */}
          {standardScenario.allFinanceResults &&
            standardScenario.allFinanceResults.length >= 1 && (
              <FinanceSectionV2 results={standardScenario.allFinanceResults} />
            )}

          {/* ── 7) rangeExceeded 안내 (옵션 초과 시) ── */}
          {standardScenario.rangeExceeded && (
            <div className="flex items-start gap-2 rounded-[14px] border border-status-warning/25 bg-status-warning-soft px-4 py-3 text-[12px] leading-relaxed text-status-warning">
              <AlertCircle size={13} className="mt-0.5 shrink-0" />
              <p className="break-keep">
                선택하신 옵션 조합으로 차량가가 등록된 견적 기준 범위를 초과해 참고용 견적으로 표시돼요.
                정확한 금액은 상담을 통해 확인해 주세요.
              </p>
            </div>
          )}

          {/* ── 8) 다른 차량과 비교 (ComparisonSection 인라인) ── */}
          {selectedVehicle && (
            <ComparisonSection
              primary={{
                slug: selectedVehicle.slug,
                brand: selectedVehicle.brand,
                name: selectedVehicle.name,
                result: quoteResult,
                thumbnailUrl: selectedVehicle.thumbnailUrl,
                trims: trims as ComparisonTrimData[],
                currentTrimId: selectedTrim?.id ?? null,
                currentOptionIds: selectedOptionIds,
              }}
              conditions={{
                contractMonths: conditions.contractMonths as 36 | 48 | 60,
                annualMileage: conditions.annualMileage as 10000 | 20000 | 30000,
                contractType: "반납형",
                productType: contractCategory,
              }}
              allVehicles={vehicles}
              onMemberLogin={onComparisonLogin}
              primaryRates={exclusivePrimaryRates(customRates)}
            />
          )}

          {/* ── 10) 체크포인트 ── */}
          <CostCheckpointV2 contractType="반납형" customerType={customerType} />

          {/* ── 11) 안내 + CTA ── */}
          <div className="break-keep rounded-[16px] bg-surface-soft p-4 text-[12px] leading-relaxed text-text-body">
            <span className="inline-block">위 견적은 실제 계약 가능한 기준이나, 최종 금액은</span>{" "}
            <span className="inline-block">차량 상태·옵션·프로모션에 따라 달라질 수 있어요.</span>{" "}
            <span className="inline-block">전문가 상담으로 확정 견적을 받아보세요.</span>
          </div>

          <QuoteResultActions
            {...deliveryBarProps}
            includeDeliveryBar={false}
          />

          <button
            type="button"
            onClick={onPrev}
            className="mx-auto flex items-center gap-1 text-[13px] font-bold text-text-muted transition-colors hover:text-text-strong"
          >
            <ChevronLeft size={14} />
            조건 다시 설정하기
          </button>
        </>
      )}
      </motion.section>
      {showDeliveryBar ? <QuoteResultDeliveryBar {...deliveryBarProps} /> : null}
    </>
  );
}

// ─── 공용 FixedCTA ──────────────────────────────────────
function FixedCTA({
  onClick,
  label,
  icon,
  onPrev,
}: {
  onClick: () => void;
  label: string;
  icon?: ReactNode;
  onPrev?: () => void;
}) {
  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface/95 px-5 pt-3 backdrop-blur-md md:static md:inset-auto md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none",
        DOCK_BOTTOM_PADDING_CLASS,
      )}
    >
      <div className="mx-auto flex max-w-[680px] gap-2">
        {onPrev && (
          <button
            type="button"
            onClick={onPrev}
            className="flex h-[52px] items-center justify-center rounded-[14px] border border-border-subtle bg-surface px-5 text-[15px] font-bold text-text-body transition-colors hover:bg-surface-soft"
          >
            이전
          </button>
        )}
        <button
          type="button"
          onClick={onClick}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-[14px] bg-brand text-[15px] font-bold text-[var(--color-brand-ink)] shadow-[0_4px_12px_rgba(39,54,138,0.18)] transition-all hover:bg-brand-pressed active:scale-[0.99]"
        >
          {icon}
          {label}
        </button>
      </div>
    </div>
  );
}

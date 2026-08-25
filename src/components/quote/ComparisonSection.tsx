"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GitCompare, ChevronDown, HelpCircle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { pickDefaultColor } from "@/lib/default-color";
import { productTypeLabel } from "@/constants/product-type";
import {
  VehicleConfigPanel,
  type ComparisonTrimData,
} from "./VehicleConfigPanel";
import { ComparisonTable, type ComparisonColumnConfig } from "./ComparisonTable";
import type { VehicleListItem, QuoteResponse } from "@/types/api";
import type { VehicleColorPublic } from "./ColorSelector";
import { useAuthUser } from "@/hooks/useAuthUser";
import { MemberGate } from "@/components/auth/MemberGate";
import {
  readSavedComparison,
  saveComparison,
  type SavedComparison,
} from "@/lib/comparison-persist";

// ─── 타입 ───────────────────────────────────────────────────
type CostMode = "none" | "initial";
type CostType = "deposit" | "prepay";

/** 비교 테이블에 표시할 견적 구성(라인업/옵션/색상)을 패널 상태에서 추출 */
function buildColumnConfig(
  trims: ComparisonTrimData[],
  trimId: string | null,
  optionIds: Set<string>,
  colors: VehicleColorPublic[],
  extColorId: string | null,
  intColorId: string | null
): ComparisonColumnConfig | undefined {
  const trim = trims.find((t) => t.id === trimId);
  if (!trim) return undefined;
  const toColor = (id: string | null) => {
    const c = id ? colors.find((color) => color.id === id) : null;
    return c ? { name: c.name, priceDelta: c.priceDelta } : null;
  };
  return {
    lineupName: trim.lineup?.name ?? trim.specs?.lineup ?? null,
    optionNames: trim.options.filter((o) => optionIds.has(o.id)).map((o) => o.name),
    exteriorColor: toColor(extColorId),
    interiorColor: toColor(intColorId),
  };
}

const PRESET_RATES = [10, 20, 30] as const;
const SLIDER_MAX = 30;
const COST_TYPE_INFO = {
  deposit: { label: "보증금", subLabel: "만기 후 환급", tooltip: "계약 종료 시 돌려받는 금액입니다." },
  prepay: { label: "선납금", subLabel: "월납입 절감", tooltip: "미리 납부해 매달 내는 금액을 줄입니다." },
} as const;

export interface PrimaryVehicleInfo {
  slug: string;
  brand: string;
  name: string;
  result: QuoteResponse;
  thumbnailUrl?: string;
  trims: ComparisonTrimData[];
  currentTrimId: string | null;
  currentOptionIds: Set<string>;
}

export interface ContractConditions {
  contractMonths: 36 | 48 | 60;
  annualMileage: 10000 | 20000 | 30000;
  contractType: "반납형" | "인수형";
  productType: "장기렌트" | "리스";
}

interface ComparisonSectionProps {
  primary: PrimaryVehicleInfo;
  conditions: ContractConditions;
  allVehicles: VehicleListItem[];
  /** 비회원 게이트의 로그인 CTA 클릭 시 호출 — 견적 화면 상태를 저장 후 /login 으로 이동 */
  onMemberLogin?: () => void;
  /**
   * 메인 견적의 보증/선납. 있으면 비교표 초기 조건과 기준 문구를 맞춘다.
   * 부모(견적 페이지)가 아직 안 넘기면 무보증·무선납 + 그 기준을 명시한다.
   */
  primaryRates?: { depositRate: number; prepayRate: number };
}

function exclusiveRates(
  rates?: { depositRate: number; prepayRate: number },
): { depositRate: number; prepayRate: number } {
  const depositRate = rates?.depositRate ?? 0;
  const prepayRate = rates?.prepayRate ?? 0;
  if (depositRate > 0 && prepayRate > 0) return { depositRate: 0, prepayRate: 0 };
  return { depositRate, prepayRate };
}

export function comparisonRateBasisLabel(rates: {
  depositRate: number;
  prepayRate: number;
}): string {
  const exclusive = exclusiveRates(rates);
  if (exclusive.depositRate > 0) {
    return `비교 월납입금은 보증금 ${exclusive.depositRate}% 기준입니다`;
  }
  if (exclusive.prepayRate > 0) {
    return `비교 월납입금은 선납금 ${exclusive.prepayRate}% 기준입니다`;
  }
  return "비교 월납입금은 보증금·선납금 없이 계산한 기준입니다";
}

// ─── 초기비용 컨트롤 ─────────────────────────────────────────
interface InitialCostControlProps {
  depositRate: number;
  prepayRate: number;
  isRecalculating: boolean;
  onChange: (rates: { depositRate: number; prepayRate: number }) => void;
}

function InitialCostControl({
  depositRate,
  prepayRate,
  isRecalculating,
  onChange,
}: InitialCostControlProps) {
  const [costMode, setCostMode] = useState<CostMode>(
    depositRate > 0 || prepayRate > 0 ? "initial" : "none"
  );
  const [costType, setCostType] = useState<CostType>("deposit");

  const activeRate = costType === "deposit" ? depositRate : prepayRate;

  const switchMode = (mode: CostMode) => {
    setCostMode(mode);
    if (mode === "none") onChange({ depositRate: 0, prepayRate: 0 });
  };

  const switchCostType = (type: CostType) => {
    setCostType(type);
    onChange({ depositRate: 0, prepayRate: 0 });
  };

  const applyRate = (rate: number) => {
    if (costType === "deposit") {
      onChange({ depositRate: rate, prepayRate: 0 });
    } else {
      onChange({ depositRate: 0, prepayRate: rate });
    }
  };

  return (
    <div className="space-y-3 bg-surface border border-line2 rounded-card p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-bold text-text-secondary uppercase tracking-wider">
          초기비용 설정
        </p>
        <span className={cn(
          "flex items-center gap-1.5 text-[11px] text-text-muted transition-opacity duration-200",
          isRecalculating ? "opacity-100" : "opacity-0 pointer-events-none"
        )}>
          <span className="inline-block w-3 h-3 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          재계산 중…
        </span>
      </div>

      {/* 없음 / 있음 토글 */}
      <div className="grid grid-cols-2 gap-2">
        {(["initial", "none"] as CostMode[]).map((mode) => {
          const isActive = costMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={cn(
                "py-3 px-3 rounded-card border-2 text-left transition-all duration-150",
                isActive
                  ? "border-brand bg-brand-soft"
                  : "border-line2 bg-surface hover:border-brand/30"
              )}
            >
              <span className="block text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">
                초기비용
              </span>
              <span className={cn("block text-[14px] font-bold", isActive ? "text-brand" : "text-text-strong")}>
                {mode === "none" ? "없음" : "있음"}
              </span>
              <span className="block text-[11px] text-text-muted mt-0.5">
                {mode === "none" ? "보증금·선납금 없이" : "초기 납부로 월납입 절감"}
              </span>
            </button>
          );
        })}
      </div>

      {/* 초기비용 상세 설정 */}
      <AnimatePresence initial={false}>
        {costMode === "initial" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-1">
              {/* 보증금 / 선납금 탭 */}
              <div className="flex gap-2">
                {(["deposit", "prepay"] as CostType[]).map((type) => {
                  const info = COST_TYPE_INFO[type];
                  const isActive = costType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => switchCostType(type)}
                      className={cn(
                        "flex-1 py-2 px-3 rounded-[10px] border text-left transition-all duration-150",
                        isActive
                          ? "border-brand bg-brand-soft"
                          : "border-line2 bg-sec hover:border-brand/30"
                      )}
                    >
                      <span className={cn("block text-[13px] font-bold", isActive ? "text-brand" : "text-text-strong")}>
                        {info.label}
                      </span>
                      <span className="block text-[10px] text-text-muted">{info.subLabel}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  title={COST_TYPE_INFO[costType].tooltip}
                  onClick={() => alert(COST_TYPE_INFO[costType].tooltip)}
                  className="p-2 rounded-full text-text-muted hover:text-text-secondary hover:bg-sec transition-colors shrink-0 self-center"
                >
                  <HelpCircle size={15} />
                </button>
              </div>

              {/* 비율 프리셋 + 슬라이더 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-text-muted">
                    {COST_TYPE_INFO[costType].label} 비율 선택
                  </p>
                  {/* 현재 값 표시 */}
                  <span className={cn(
                    "num text-[14px] font-extrabold tabular-nums transition-colors",
                    activeRate > 0 ? "text-brand" : "text-text-muted"
                  )}>
                    {activeRate}%
                  </span>
                </div>

                {/* 프리셋 버튼 */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyRate(0)}
                    className={cn(
                      "px-3.5 py-2 rounded-full border text-[12px] font-medium transition-all duration-150",
                      activeRate === 0
                        ? "bg-text-strong text-surface border-text-strong"
                        : "bg-surface text-text-secondary border-border-subtle hover:border-text-strong/40"
                    )}
                  >
                    없음
                  </button>
                  {PRESET_RATES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => applyRate(r)}
                      className={cn(
                        "px-3.5 py-2 rounded-full border text-[12px] font-bold transition-all duration-150",
                        activeRate === r
                          ? "bg-brand text-[var(--color-brand-ink)] border-brand"
                          : "bg-surface text-text-secondary border-line2 hover:border-brand/40"
                      )}
                    >
                      {r}%
                    </button>
                  ))}
                </div>

                {/* 슬라이더 */}
                <div className="space-y-1">
                  <div className="relative h-5 flex items-center">
                    <div className="absolute inset-x-0 h-[6px] rounded-full bg-border-subtle overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-200"
                        style={{
                          // 썸 중심 위치까지 채움 — 썸 이동 범위 보정과 동일 식
                          width: `calc(${(activeRate / SLIDER_MAX)} * (100% - 20px) + 10px)`,
                          background: "var(--color-brand-primary)",
                        }}
                      />
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={SLIDER_MAX}
                      step={1}
                      value={activeRate}
                      onChange={(e) => applyRate(Number(e.target.value))}
                      className="absolute inset-0 opacity-0 w-full cursor-pointer"
                    />
                    {/* 썸 — 이동 범위를 (전체 폭 − 썸 지름)으로 보정해 양 끝에서 잘리지 않게 */}
                    <div
                      className="absolute w-5 h-5 rounded-full -translate-x-1/2 pointer-events-none transition-all duration-200 shadow-md"
                      style={{
                        left: `calc(${(activeRate / SLIDER_MAX)} * (100% - 20px) + 10px)`,
                        background: "var(--color-surface)",
                        border: "2.5px solid var(--color-brand-primary)",
                        boxShadow: activeRate > 0 ? "var(--shadow-card-hover)" : "var(--shadow-card)",
                      }}
                    />
                  </div>
                  {/* 클릭 가능한 눈금 레이블 */}
                  <div className="flex justify-between px-0.5">
                    {[0, 10, 20, 30].map((tick) => (
                      <button
                        key={tick}
                        type="button"
                        onClick={() => applyRate(tick)}
                        className={cn(
                          "text-[10px] font-medium transition-colors px-0.5",
                          activeRate === tick
                            ? "text-brand font-bold"
                            : "text-text-muted hover:text-brand"
                        )}
                      >
                        {tick}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {(depositRate > 0 || prepayRate > 0) && (
                <p className="text-[12px] text-brand font-bold">
                  두 차량 모두{" "}
                  {depositRate > 0 ? `보증금 ${depositRate}%` : `선납금 ${prepayRate}%`} 적용
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── 메인 컴포넌트 ───────────────────────────────────────────
export function ComparisonSection({
  primary,
  conditions,
  allVehicles,
  onMemberLogin,
  primaryRates,
}: ComparisonSectionProps) {
  // '이전'으로 돌아갔다 와도 비교 차량 설정이 유지되도록 sessionStorage 저장본을 1회 읽는다.
  // (트림/옵션/색상은 비동기 로드 후 적용해야 하므로 ref 에 담아 로드 effect 에서 소비)
  const [saved] = useState<SavedComparison | null>(() =>
    readSavedComparison(primary.slug)
  );

  const [isOpen, setIsOpen] = useState(saved?.isOpen ?? false);

  // 비교 기능은 회원 전용. 비회원에게는 펼친 패널을 블러 처리하고 카카오 로그인을 유도한다.
  // user 는 null 로 시작 → 로딩 중엔 잠금 기본값(보증/선납 게이트와 동일).
  const { user } = useAuthUser();
  const locked = !user;

  // ── 패널 1 상태 ──────────────────────────────────────────────
  const [p1TrimId, setP1TrimId] = useState<string | null>(primary.currentTrimId);
  const [p1OptionIds, setP1OptionIds] = useState<Set<string>>(new Set(primary.currentOptionIds));
  const [p1Colors, setP1Colors] = useState<VehicleColorPublic[]>([]);
  const [p1ExtColor, setP1ExtColor] = useState<string | null>(null);
  const [p1IntColor, setP1IntColor] = useState<string | null>(null);
  const [p1ProductType, setP1ProductType] = useState<"장기렌트" | "리스">(conditions.productType);

  // ── 패널 2 상태 ──────────────────────────────────────────────
  const [p2Slug, setP2Slug] = useState(saved?.p2Slug ?? "");
  const [p2Trims, setP2Trims] = useState<ComparisonTrimData[]>([]);
  const [p2TrimsLoading, setP2TrimsLoading] = useState(false);
  const [p2TrimId, setP2TrimId] = useState<string | null>(null);
  const [p2OptionIds, setP2OptionIds] = useState<Set<string>>(new Set());
  const [p2Colors, setP2Colors] = useState<VehicleColorPublic[]>([]);
  const [p2ExtColor, setP2ExtColor] = useState<string | null>(null);
  const [p2IntColor, setP2IntColor] = useState<string | null>(null);
  const [p2ProductType, setP2ProductType] = useState<"장기렌트" | "리스">(
    saved?.p2ProductType ?? conditions.productType
  );

  // 저장본의 트림/옵션/색상 — p2 트림·색상 로드 완료 후 유효성 검증을 거쳐 1회 적용
  const restoreP2Ref = useRef(
    saved
      ? {
          trimId: saved.p2TrimId,
          optionIds: saved.p2OptionIds,
          extColor: saved.p2ExtColor,
          intColor: saved.p2IntColor,
        }
      : null
  );

  // ── 비교 결과 ────────────────────────────────────────────────
  const [primaryResult, setPrimaryResult] = useState<QuoteResponse | null>(null);
  const [compResult, setCompResult] = useState<QuoteResponse | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);

  // ── 공유 초기비용 (결과 표시 후 슬라이더) ───────────────────
  const [sharedRates, setSharedRates] = useState(() => exclusiveRates(primaryRates));
  const hasResults = !!(primaryResult && compResult);

  // 메인 견적 조건이 바뀌면 비교 기준도 같이 맞춘다(표기·초기 계산 정합).
  useEffect(() => {
    setSharedRates(exclusiveRates(primaryRates));
  }, [primaryRates?.depositRate, primaryRates?.prepayRate]);

  // ── 모바일 탭 ────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"primary" | "comparison">("primary");

  const abortRef = useRef<AbortController | null>(null);
  const recalcTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 현재 차량 복사 시 트림·옵션 동기화에 사용
  const copyTrimRef = useRef<{ trimId: string | null; optionIds: Set<string> } | null>(null);

  // 패널 1 색상 로드 (primary 차량)
  useEffect(() => {
    if (!primary.slug) return;
    let aborted = false;
    fetch(`/api/vehicles/${primary.slug}/colors`)
      .then((r) => r.json())
      .then((json) => {
        if (aborted || !json?.success || !Array.isArray(json.data)) return;
        const list: VehicleColorPublic[] = json.data;
        setP1Colors(list);
        const defExt = pickDefaultColor(list, "EXTERIOR");
        const defInt = pickDefaultColor(list, "INTERIOR");
        setP1ExtColor(defExt?.id ?? null);
        setP1IntColor(defInt?.id ?? null);
      })
      .catch(() => {});
    return () => { aborted = true; };
  }, [primary.slug]);

  // 비교 차량 트림 + 색상 로드
  useEffect(() => {
    if (!p2Slug) {
      setP2Trims([]);
      setP2TrimId(null);
      setP2OptionIds(new Set());
      setP2Colors([]);
      setP2ExtColor(null);
      setP2IntColor(null);
      return;
    }
    let aborted = false;
    setP2TrimsLoading(true);
    setP2Trims([]);
    setP2TrimId(null);
    setP2OptionIds(new Set());
    setP2Colors([]);
    setP2ExtColor(null);
    setP2IntColor(null);

    Promise.all([
      fetch(`/api/vehicles/${p2Slug}/trims`).then((r) => r.json()),
      fetch(`/api/vehicles/${p2Slug}/colors`).then((r) => r.json()),
    ])
      .then(([trimJson, colorJson]) => {
        if (aborted) return;
        const restore = restoreP2Ref.current;
        restoreP2Ref.current = null; // 첫 로드에서만 1회 적용
        if (trimJson.success && Array.isArray(trimJson.data)) {
          const loadedTrims = trimJson.data as ComparisonTrimData[];
          setP2Trims(loadedTrims);
          // 현재 차량 복사 시 트림·옵션 자동 세팅
          if (copyTrimRef.current) {
            const { trimId, optionIds } = copyTrimRef.current;
            // 로딩된 트림 목록에 해당 trimId가 있을 때만 세팅
            if (trimId && loadedTrims.some((t) => t.id === trimId)) {
              setP2TrimId(trimId);
              setP2OptionIds(new Set(optionIds));
            }
            copyTrimRef.current = null;
          } else if (restore?.trimId) {
            // 세션 저장본 복원 — 트림·옵션이 여전히 유효할 때만 적용
            const restoredTrim = loadedTrims.find((t) => t.id === restore.trimId);
            if (restoredTrim) {
              setP2TrimId(restoredTrim.id);
              const validOptionIds = new Set(restoredTrim.options.map((o) => o.id));
              setP2OptionIds(
                new Set(restore.optionIds.filter((id) => validOptionIds.has(id)))
              );
            }
          }
        }
        if (colorJson?.success && Array.isArray(colorJson.data)) {
          const list: VehicleColorPublic[] = colorJson.data;
          setP2Colors(list);
          const defExt = pickDefaultColor(list, "EXTERIOR");
          const defInt = pickDefaultColor(list, "INTERIOR");
          // 세션 저장본의 색상이 유효하면 복원, 아니면 기본 색상
          const restoredExt = restore?.extColor && list.some((c) => c.id === restore.extColor)
            ? restore.extColor : null;
          const restoredInt = restore?.intColor && list.some((c) => c.id === restore.intColor)
            ? restore.intColor : null;
          setP2ExtColor(restoredExt ?? defExt?.id ?? null);
          setP2IntColor(restoredInt ?? defInt?.id ?? null);
        }
      })
      .catch(() => {})
      .finally(() => { if (!aborted) setP2TrimsLoading(false); });

    return () => { aborted = true; };
  }, [p2Slug]);

  // 비교 차량 설정 변경 시 sessionStorage 에 저장 — '이전' 이동/새로고침 후에도 유지
  useEffect(() => {
    saveComparison(primary.slug, {
      isOpen,
      p2Slug,
      p2TrimId,
      p2OptionIds: [...p2OptionIds],
      p2ExtColor,
      p2IntColor,
      p2ProductType,
    });
  }, [isOpen, p2Slug, p2TrimId, p2OptionIds, p2ExtColor, p2IntColor, p2ProductType, primary.slug]);

  // 섹션 열릴 때 패널 1 초기값 동기화
  const handleOpen = () => {
    if (!isOpen) {
      setP1TrimId(primary.currentTrimId);
      setP1OptionIds(new Set(primary.currentOptionIds));
      setP1ProductType(conditions.productType);
      setPrimaryResult(null);
      setCompResult(null);
      setSharedRates(exclusiveRates(primaryRates));
      setCompareError(null);
    }
    setIsOpen((v) => !v);
  };

  // 현재 차량을 비교 패널로 복사 (트림·옵션 포함)
  const handleCopyPrimary = () => {
    // 트림 로드 완료 후 자동 세팅하기 위해 ref에 저장
    copyTrimRef.current = { trimId: p1TrimId, optionIds: new Set(p1OptionIds) };
    setP2Slug(primary.slug);
    setPrimaryResult(null);
    setCompResult(null);
  };

  // ── API 호출 공통 함수 ───────────────────────────────────────
  const fetchBothQuotes = useCallback(async (
    rates: { depositRate: number; prepayRate: number },
    isInitial: boolean,
  ) => {
    if (!p1TrimId || !p2Slug || !p2TrimId) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    if (isInitial) setIsComparing(true);
    else setIsRecalculating(true);
    setCompareError(null);

    const baseConditions = {
      contractMonths: conditions.contractMonths,
      annualMileage: conditions.annualMileage,
      contractType: conditions.contractType,
    };

    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/vehicles/${primary.slug}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...baseConditions,
            productType: p1ProductType,
            trimId: p1TrimId,
            selectedOptionIds: Array.from(p1OptionIds),
            ...(p1ExtColor && { exteriorColorId: p1ExtColor }),
            ...(p1IntColor && { interiorColorId: p1IntColor }),
            ...(rates.depositRate > 0 && { customDepositRate: rates.depositRate }),
            ...(rates.prepayRate > 0 && { customPrepayRate: rates.prepayRate }),
          }),
          signal: ctrl.signal,
        }),
        fetch(`/api/vehicles/${p2Slug}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...baseConditions,
            productType: p2ProductType,
            trimId: p2TrimId,
            selectedOptionIds: Array.from(p2OptionIds),
            ...(p2ExtColor && { exteriorColorId: p2ExtColor }),
            ...(p2IntColor && { interiorColorId: p2IntColor }),
            ...(rates.depositRate > 0 && { customDepositRate: rates.depositRate }),
            ...(rates.prepayRate > 0 && { customPrepayRate: rates.prepayRate }),
          }),
          signal: ctrl.signal,
        }),
      ]);

      const [j1, j2] = await Promise.all([r1.json(), r2.json()]);
      if (ctrl.signal.aborted) return;

      if (!j1.success || !j2.success) {
        setCompareError(j1.error ?? j2.error ?? "견적 계산에 실패했습니다.");
        return;
      }

      setPrimaryResult(j1.data as QuoteResponse);
      setCompResult(j2.data as QuoteResponse);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setCompareError("네트워크 오류가 발생했습니다.");
    } finally {
      if (!ctrl.signal.aborted) {
        setIsComparing(false);
        setIsRecalculating(false);
      }
    }
  }, [p1TrimId, p1OptionIds, p1ExtColor, p1IntColor, p1ProductType,
      p2Slug, p2TrimId, p2OptionIds, p2ExtColor, p2IntColor, p2ProductType,
      conditions, primary.slug]);

  // 초기비용 변경 시 디바운스 재계산 (결과가 있을 때만)
  const handleRatesChange = (rates: { depositRate: number; prepayRate: number }) => {
    setSharedRates(rates);
    if (!hasResults) return;

    if (recalcTimerRef.current) clearTimeout(recalcTimerRef.current);
    recalcTimerRef.current = setTimeout(() => {
      void fetchBothQuotes(rates, false);
    }, 500);
  };

  const canCompare = !!p1TrimId && !!p2Slug && !!p2TrimId;
  const p2Meta = allVehicles.find((v) => v.slug === p2Slug);

  return (
    <div className="bg-surface rounded-card border border-line2 shadow-soft overflow-hidden mb-4 max-w-full">
      {/* 섹션 헤더 */}
      <button
        type="button"
        onClick={handleOpen}
        className="w-full max-w-full box-border flex items-center gap-2.5 px-4 py-4 text-left transition-colors hover:bg-sec sm:gap-3 sm:px-5"
        aria-expanded={isOpen}
      >
        <div className="w-8 h-8 rounded-full bg-brand-soft flex items-center justify-center shrink-0">
          <GitCompare size={15} className="text-brand" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-[14px] font-bold text-ink">
            <span className="min-w-0 truncate">다른 차량과 비교하기</span>
            {locked && <Lock size={12} className="text-ink-caption shrink-0" />}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-caption break-keep">
            {locked
              ? "회원 전용 기능입니다. 로그인하고 나란히 비교하세요"
              : "트림·옵션을 각각 설정하고 나란히 비교할 수 있습니다"}
          </p>
        </div>
        <ChevronDown
          size={16}
          className={cn("text-brand shrink-0 transition-transform duration-200", isOpen && "rotate-180")}
        />
      </button>

      {/* 섹션 바디 — 비회원은 블러 + 카카오 로그인 유도 */}
      {isOpen && (
        <div className="border-t border-border-subtle">
        <MemberGate
          locked={locked}
          onLogin={onMemberLogin}
          message="비교는 회원 전용입니다. 로그인 해주세요"
        >
          {/* 모바일 탭 */}
          <div className="md:hidden flex border-b border-border-subtle">
            {(["primary", "comparison"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex-1 py-2.5 text-[13px] font-bold transition-colors",
                  activeTab === tab
                    ? "text-brand border-b-2 border-brand bg-brand-soft"
                    : "text-text-secondary hover:bg-sec"
                )}
              >
                {tab === "primary" ? "현재 차량" : "비교 차량"}
              </button>
            ))}
          </div>

          {/* 두 패널 */}
          <div className="md:grid md:grid-cols-2 md:divide-x md:divide-border-subtle">
            {/* 패널 1 */}
            <div className={cn("min-h-[320px]", activeTab === "primary" ? "block" : "hidden md:block")}>
              <VehicleConfigPanel
                mode="primary"
                vehicleBrand={primary.brand}
                vehicleName={primary.name}
                thumbnailUrl={primary.thumbnailUrl}
                trims={primary.trims}
                selectedTrimId={p1TrimId}
                onTrimChange={(id) => { setP1TrimId(id); setP1OptionIds(new Set()); setPrimaryResult(null); setCompResult(null); }}
                selectedOptionIds={p1OptionIds}
                onOptionToggle={(id) => {
                  setP1OptionIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  });
                  setPrimaryResult(null); setCompResult(null);
                }}
                onOptionsClear={() => { setP1OptionIds(new Set()); setPrimaryResult(null); setCompResult(null); }}
                colors={p1Colors}
                exteriorColorId={p1ExtColor}
                interiorColorId={p1IntColor}
                onColorChange={(kind, id) => {
                  if (kind === "EXTERIOR") setP1ExtColor(id);
                  else setP1IntColor(id);
                  setPrimaryResult(null); setCompResult(null);
                }}
                productType={p1ProductType}
                onProductTypeChange={(v) => { setP1ProductType(v); setPrimaryResult(null); setCompResult(null); }}
              />
            </div>

            {/* 패널 2 */}
            <div className={cn("min-h-[320px] border-t border-border-subtle md:border-t-0", activeTab === "comparison" ? "block" : "hidden md:block")}>
              <VehicleConfigPanel
                mode="comparison"
                allVehicles={allVehicles}
                excludeSlug={primary.slug}
                selectedSlug={p2Slug}
                onVehicleChange={(slug) => { setP2Slug(slug); setPrimaryResult(null); setCompResult(null); }}
                trims={p2Trims}
                trimsLoading={p2TrimsLoading}
                selectedTrimId={p2TrimId}
                onTrimChange={(id) => { setP2TrimId(id); setP2OptionIds(new Set()); setPrimaryResult(null); setCompResult(null); }}
                selectedOptionIds={p2OptionIds}
                onOptionToggle={(id) => {
                  setP2OptionIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  });
                  setPrimaryResult(null); setCompResult(null);
                }}
                onOptionsClear={() => { setP2OptionIds(new Set()); setPrimaryResult(null); setCompResult(null); }}
                colors={p2Colors}
                exteriorColorId={p2ExtColor}
                interiorColorId={p2IntColor}
                onColorChange={(kind, id) => {
                  if (kind === "EXTERIOR") setP2ExtColor(id);
                  else setP2IntColor(id);
                  setPrimaryResult(null); setCompResult(null);
                }}
                productType={p2ProductType}
                onProductTypeChange={(v) => { setP2ProductType(v); setPrimaryResult(null); setCompResult(null); }}
                primarySlug={primary.slug}
                onCopyPrimary={handleCopyPrimary}
              />
            </div>
          </div>

          {/* 비교 버튼 */}
          <div className="px-4 py-4 border-t border-border-subtle space-y-2">
            {!canCompare && (
              <p className="text-[12px] text-text-muted text-center">
                {!p1TrimId ? "현재 차량의 트림을 선택해주세요" : !p2Slug ? "비교할 차량을 선택해주세요" : "비교 차량의 트림을 선택해주세요"}
              </p>
            )}
            <button
              type="button"
              onClick={() => void fetchBothQuotes(sharedRates, true)}
              disabled={!canCompare || isComparing}
              className={cn(
                "w-full py-3 rounded-btn text-[14px] font-bold transition-all",
                canCompare && !isComparing
                  ? "bg-brand text-[var(--color-brand-ink)] hover:bg-brand-dark shadow-lift"
                  : "bg-sec text-text-muted cursor-not-allowed"
              )}
            >
              {isComparing ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  견적 계산 중...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <GitCompare size={16} />
                  비교 견적 계산하기
                </span>
              )}
            </button>
            <p className="text-[11px] text-ink-caption text-center">
              계약 {conditions.contractMonths}개월 · 연 {(conditions.annualMileage / 10000).toFixed(0)}만km · {conditions.contractType} · {productTypeLabel(conditions.productType)}
            </p>
            <p className="text-[11px] text-ink-caption text-center">
              {comparisonRateBasisLabel(sharedRates)}
            </p>
          </div>

          {/* 에러 */}
          {compareError && (
            <div className="mx-4 mb-4 bg-red-50 border border-red-100 rounded-[8px] p-3 text-[13px] text-red-500">
              {compareError}
            </div>
          )}

          {/* 결과 영역 */}
          <AnimatePresence>
            {primaryResult && compResult && p2Meta && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="px-4 pb-4 space-y-3"
              >
                {/* ── 공유 초기비용 컨트롤 ── */}
                <InitialCostControl
                  depositRate={sharedRates.depositRate}
                  prepayRate={sharedRates.prepayRate}
                  isRecalculating={isRecalculating}
                  onChange={handleRatesChange}
                />

                {/* ── 비교 테이블 ── */}
                <ComparisonTable
                  primary={{
                    brand: primary.brand,
                    name: primary.name,
                    result: primaryResult,
                    config: buildColumnConfig(primary.trims, p1TrimId, p1OptionIds, p1Colors, p1ExtColor, p1IntColor),
                  }}
                  comparison={{
                    brand: p2Meta.brand,
                    name: p2Meta.name,
                    result: compResult,
                    config: buildColumnConfig(p2Trims, p2TrimId, p2OptionIds, p2Colors, p2ExtColor, p2IntColor),
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </MemberGate>
        </div>
      )}
    </div>
  );
}

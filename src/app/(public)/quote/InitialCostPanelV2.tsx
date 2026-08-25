"use client";

import { useState } from "react";
import { TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";
import { useAuthUser } from "@/hooks/useAuthUser";
import { isPublicQuoteResultRates } from "@/lib/member-gate";
import type { QuoteScenarioDetail } from "@/types/quote";

// ─── 타입 ────────────────────────────────────────────────
export type CostMode = "none" | "initial";
type CostType = "deposit" | "prepay";

interface InitialCostPanelV2Props {
  /** 기준(가산 전) standard 시나리오 — 절감액 계산용 */
  data: QuoteScenarioDetail;
  customRates: { depositRate: number; prepayRate: number };
  onCustomRatesChange: (rates: { depositRate: number; prepayRate: number }) => void;
  isRecalculating: boolean;
  costMode: CostMode;
  onCostModeChange: (mode: CostMode) => void;
  /** 비회원 게이트 로그인 CTA */
  onMemberLogin: () => void;
  /** "없음"으로 돌아갈 때 호출 (기준 시나리오 복원) */
  onReset: () => void;
}

const PRESET_RATES = [10, 20, 30] as const;
const RATE_MAX = 30;

const COST_MODE_OPTIONS: {
  mode: CostMode;
  title: string;
  desc: string;
}[] = [
  { mode: "initial", title: "있음", desc: "초기 납부로 월납입 절감" },
  { mode: "none", title: "없음", desc: "보증금·선납금 없이 시작" },
];

const COST_TYPE_INFO = {
  deposit: {
    label: "보증금",
    subLabel: "계약 후 반환",
    tooltip: "계약 시 납부하는 담보금. 월 납입금을 낮추며 계약 종료 후 전액 반환됩니다.",
  },
  prepay: {
    label: "선납금",
    subLabel: "미리 납부",
    tooltip: "렌트 기간 일부 금액을 미리 납부. 반환되지 않으나 월 납입금을 크게 낮춥니다.",
  },
};

// ════════════════════════════════════════════════════════════
// 메인 — 초기비용(보증금/선납금) 패널 v2
// ════════════════════════════════════════════════════════════
export function InitialCostPanelV2({
  data,
  customRates,
  onCustomRatesChange,
  isRecalculating,
  costMode,
  onCostModeChange,
  onMemberLogin,
  onReset,
}: InitialCostPanelV2Props) {
  const [costType, setCostType] = useState<CostType>(() =>
    (customRates?.prepayRate ?? 0) > 0 ? "prepay" : "deposit"
  );

  // 비회원은 선납 30% 결과만 볼 수 있다. user 는 null 로 시작 → 로딩 중엔 게스트 기본값.
  const { user } = useAuthUser();
  const isGuest = !user;

  const depositRate = customRates?.depositRate ?? 0;
  const prepayRate = customRates?.prepayRate ?? 0;
  const activeRate = costType === "deposit" ? depositRate : prepayRate;

  const allowOrGate = (
    nextRates: { depositRate: number; prepayRate: number } | null,
    apply: () => void,
  ) => {
    if (isGuest && (!nextRates || !isPublicQuoteResultRates(nextRates))) {
      onMemberLogin();
      return;
    }
    apply();
  };

  const switchMode = (mode: CostMode) => {
    if (mode === "none") {
      allowOrGate({ depositRate: 0, prepayRate: 0 }, () => {
        onCustomRatesChange({ depositRate: 0, prepayRate: 0 });
        onReset();
        onCostModeChange(mode);
      });
      return;
    }
    onCostModeChange(mode);
  };

  const switchCostType = (type: CostType) => {
    if (isGuest && type === "deposit") {
      onMemberLogin();
      return;
    }
    setCostType(type);
    if (!isGuest) {
      onCustomRatesChange({ depositRate: 0, prepayRate: 0 });
    }
  };

  const applyRate = (rate: number) => {
    const next =
      costType === "deposit"
        ? { depositRate: rate, prepayRate: 0 }
        : { depositRate: 0, prepayRate: rate };
    allowOrGate(next, () => onCustomRatesChange(next));
  };

  // 절감 정보
  const discountInfo = (() => {
    const bd = data.breakdown;
    if (!bd) return null;
    if (costType === "deposit" && data.depositAmount > 0 && bd.depositDiscount > 0) {
      const annual = bd.depositDiscount * 12;
      return {
        monthly: bd.depositDiscount,
        effectiveRate: (annual / data.depositAmount) * 100,
        amount: data.depositAmount,
        returned: true,
        typeLabel: "보증금",
      };
    }
    if (costType === "prepay" && data.prepayAmount > 0 && bd.prepayAdjust < 0) {
      const monthly = Math.abs(bd.prepayAdjust);
      const annual = monthly * 12;
      return {
        monthly,
        effectiveRate: (annual / data.prepayAmount) * 100,
        amount: data.prepayAmount,
        returned: false,
        typeLabel: "선납금",
      };
    }
    return null;
  })();

  return (
    <div className="space-y-4">
      {/* ① 납입 방식 토글 */}
      <div className="grid grid-cols-2 gap-2.5">
        {COST_MODE_OPTIONS.map(({ mode, title, desc }) => {
          const isActive = costMode === mode;
          // 게스트 한정: 없음 카드에 회원 혜택 스티커 + 그린 포인트. 회원은 기존 비활성 회색 유지.
          const showGuestPerk = isGuest && mode === "none" && !isActive;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => switchMode(mode)}
              className={cn(
                "relative min-h-[78px] rounded-[16px] px-4 py-3.5 text-left transition-all duration-200",
                isActive
                  ? "bg-brand-soft ring-[1.5px] ring-brand"
                  : showGuestPerk
                    ? "bg-status-positive-soft ring-[1.5px] ring-status-positive/50 hover:ring-status-positive"
                    : "bg-surface-soft ring-[1.5px] ring-transparent hover:ring-border-subtle"
              )}
            >
              {showGuestPerk && (
                <span className="absolute -top-4 right-2 rounded-full bg-status-warning px-3.5 py-1.5 text-[13.5px] font-extrabold leading-tight text-surface shadow-card motion-safe:animate-nudge after:absolute after:-bottom-[4px] after:right-4 after:h-2 after:w-2 after:rotate-45 after:bg-status-warning after:content-['']">
                  80% 고객이 선택함
                </span>
              )}
              <span className="block text-[10px] font-medium uppercase tracking-[0.06em] text-text-muted">
                초기비용
              </span>
              <span className={cn("mt-0.5 block text-[15px] font-bold", isActive ? "text-brand" : "text-text-strong")}>
                {title}
              </span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-text-body">{desc}</span>
            </button>
          );
        })}
      </div>

      {/* ② 초기비용 설정 — 선납 30% 결과는 비회원에게도 보여 준다 */}
      {costMode === "initial" && (
        <div className="space-y-4 rounded-[20px] bg-surface-soft p-5">
            {/* 헤더 + recalculate 표시 */}
            <div className="flex items-center justify-between">
              <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-text-muted">초기비용 설정</p>
              <span className={cn(
                "flex items-center gap-1.5 text-[11.5px] text-text-muted transition-opacity duration-200",
                isRecalculating ? "opacity-100" : "pointer-events-none opacity-0"
              )}>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
                재계산 중…
              </span>
            </div>

            {/* 보증금/선납금 선택 */}
            <div className="flex items-center gap-2">
              {(["deposit", "prepay"] as CostType[]).map((type) => {
                const info = COST_TYPE_INFO[type];
                const isActive = costType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => switchCostType(type)}
                    className={cn(
                      "flex-1 rounded-[12px] px-3 py-2.5 text-left transition-all duration-150",
                      isActive ? "bg-surface ring-[1.5px] ring-brand" : "bg-surface/60 ring-[1.5px] ring-transparent hover:ring-border-subtle"
                    )}
                  >
                    <span className={cn("block text-[13px] font-bold", isActive ? "text-brand" : "text-text-strong")}>
                      {info.label}
                    </span>
                    <span className="block text-[10.5px] text-text-muted">{info.subLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* 프리셋 칩 */}
            <div>
              <p className="mb-2 text-[12px] text-text-muted">{COST_TYPE_INFO[costType].label} 비율 선택</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => applyRate(0)}
                  className={cn(
                    "rounded-full border px-3.5 py-2 text-[12px] font-bold transition-all duration-150",
                    activeRate === 0
                      ? "border-text-strong bg-text-strong text-surface"
                      : "border-border-subtle bg-surface text-text-body hover:border-text-strong/40"
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
                      "rounded-full border px-3.5 py-2 text-[12px] font-bold transition-all duration-150",
                      activeRate === r
                        ? "border-brand bg-brand text-[var(--color-brand-ink)]"
                      : "border-border-subtle bg-surface text-text-body hover:border-brand/40"
                    )}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </div>

            {/* 슬라이더 */}
            <div className="space-y-1.5">
              <div className="relative flex h-5 items-center">
                <div className="absolute inset-x-0 h-[6px] overflow-hidden rounded-full bg-border-subtle">
                  <div
                    className="h-full rounded-full bg-brand transition-all duration-300"
                    style={{
                      width: `calc(${activeRate / RATE_MAX} * (100% - 20px) + 10px)`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={RATE_MAX}
                  step={1}
                  value={activeRate}
                  onChange={(e) => applyRate(Number(e.target.value))}
                  className="absolute inset-0 w-full cursor-pointer opacity-0"
                  aria-label={`${COST_TYPE_INFO[costType].label} 비율`}
                />
                <div
                  className="pointer-events-none absolute h-5 w-5 -translate-x-1/2 rounded-full border-[2.5px] border-brand bg-surface shadow-card transition-all duration-300"
                  style={{
                    left: `calc(${activeRate / RATE_MAX} * (100% - 20px) + 10px)`,
                  }}
                />
              </div>
              {/* 눈금 라벨 */}
              <div className="flex justify-between px-0.5">
                {[0, 10, 20, 30].map((tick) => (
                  <button
                    key={tick}
                    type="button"
                    onClick={() => applyRate(tick)}
                    className={cn(
                      "px-0.5 text-[10.5px] font-medium transition-colors",
                      activeRate === tick ? "font-bold text-brand" : "text-text-muted hover:text-brand"
                    )}
                  >
                    {tick === 0 ? "0%" : `${tick}%`}
                  </button>
                ))}
              </div>
            </div>

            {/* 절감 효과 */}
            {discountInfo && (
              <div className="rounded-[14px] border border-brand/20 bg-brand-soft p-3.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-bold text-brand">
                    <TrendingDown size={13} />
                    월 납입금 절감
                  </span>
                  <span className="num text-[15px] font-extrabold text-brand tabular-nums">
                    −{formatCurrency(discountInfo.monthly)}/월
                  </span>
                </div>
                <p className="text-[11.5px] leading-relaxed text-brand/80">
                  납부한 {discountInfo.typeLabel}({formatCurrency(discountInfo.amount)})의 연간
                  수익률로 환산하면 약{" "}
                  <span className="font-bold text-brand">{discountInfo.effectiveRate.toFixed(1)}%</span>
                  에 해당해요.
                  {discountInfo.returned
                    ? " 보증금은 계약 종료 후 전액 반환돼요."
                    : " 선납금은 반환되지 않으나 그만큼 매달 부담이 줄어요."}
                </p>
              </div>
            )}
        </div>
      )}
    </div>
  );
}

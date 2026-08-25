"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn, formatCurrency } from "@/lib/utils";
import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import type { RecommendedVehicle } from "@/types/recommendation";
import { AiInsight } from "@/components/quote/AiInsight";
import { ChannelTalkButton } from "@/components/quote/ChannelTalkButton";
import { AiBadgeIcon } from "@/components/ui/AiBadgeIcon";
import { TossPrice } from "@/components/ui/TossPrice";
import { ChevronRight, Trophy, Check, Users } from "lucide-react";
import { industryToCustomerType } from "@/constants/customer-types";
import { useAuthUser } from "@/hooks/useAuthUser";
import { MemberGate } from "@/components/auth/MemberGate";
import {
  DEFAULT_PUBLIC_QUOTE_PRODUCT_TYPE,
  PUBLIC_CARD_QUOTE_CONDITION,
} from "@/constants/quote-defaults";

interface RecommendVehicleCardProps {
  vehicle: RecommendedVehicle;
  isTop?: boolean;
  industry?: string;
}

const RANK_LABELS: Record<number, string> = {
  1: "1순위 추천",
  2: "2순위 추천",
  3: "3순위 추천",
};

export function RecommendVehicleCard({ vehicle, isTop = false, industry }: RecommendVehicleCardProps) {
  const { vehicle: detail, scenarios, reason, highlights, rank } = vehicle;
  const router = useRouter();
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // 비회원에게는 보증금형·선납형(낮아진 월납입금) 카드를 블러 처리한다.
  // 서버가 비회원 응답에서 해당 시나리오를 잠그면(scenarios.*.locked) 클라이언트 인증
  // 상태와 무관하게 잠금 유지 — 서버가 실제 값을 안 줬으므로 0 이 노출되지 않게 막는다.
  const { user } = useAuthUser();
  const locked = !user || scenarios.conservative.locked === true;

  const toggleItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectedTotal = detail.popularConfigs
    .flatMap((c) => c.items)
    .filter((i) => selectedItems.has(i.id))
    .reduce((sum, i) => sum + i.price, 0);

  const hasConfigs = detail.popularConfigs.length > 0;

  // 카드 공통 계약기간 실부담(돌려받지 못하는 실제 비용) 계산
  // - 무보증/보증금형: 월납 × 개월수 (보증금은 계약 종료 시 환급되므로 실부담에서 제외)
  // - 선납형: 월납 × 개월수 + 선납금(환급 안 됨)
  const months = scenarios.standard.contractMonths || 48;
  const standardTotalCost = scenarios.standard.monthlyPayment * months;
  const depositTotalCost = scenarios.conservative.monthlyPayment * months;
  const prepayTotalCost =
    scenarios.aggressive.monthlyPayment * months + scenarios.aggressive.prepayAmount;
  const formatMan = (won: number) =>
    `${Math.round(won / 10000).toLocaleString("ko-KR")}만원`;

  // 카드 금액은 quote-calculator 가 금융사 순위 가산(최저가 1순위 기준)을 더한 결과다.
  // 다른 화면 금액과 기준이 같다는 걸 밝히기 위한 표기이므로, 잠기거나 0원이라
  // 실제 견적 금액이 없는 카드에는 붙이지 않는다.
  const showsRankSurchargeNote =
    scenarios.standard.locked !== true && scenarios.standard.monthlyPayment > 0;

  function handleQuote() {
    const params = new URLSearchParams({
      vehicle: detail.slug,
      customerType: industryToCustomerType(industry),
      productType: detail.productType ?? DEFAULT_PUBLIC_QUOTE_PRODUCT_TYPE,
      contractMonths: String(PUBLIC_CARD_QUOTE_CONDITION.contractMonths),
      annualMileage: String(PUBLIC_CARD_QUOTE_CONDITION.annualMileage),
      source: "AI",
    });
    if (detail.recommendedTrimId) {
      params.set("trim", detail.recommendedTrimId);
    }
    if (selectedItems.size > 0) {
      const allItems = detail.popularConfigs.flatMap((c) => c.items);
      const trimOptionIds = Array.from(selectedItems)
        .map((pciId) => allItems.find((i) => i.id === pciId)?.trimOptionId)
        .filter((id): id is string => !!id);
      if (trimOptionIds.length > 0) {
        params.set("options", trimOptionIds.join(","));
      }
    }
    router.push(`/quote?${params.toString()}`);
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[18px] bg-surface shadow-card",
        isTop ? "border-[1.5px] border-brand" : "border border-border-subtle"
      )}
    >
      {/* 순위 배지 */}
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2.5",
          isTop ? "bg-brand" : "bg-surface-soft"
        )}
      >
        {isTop && <Trophy size={14} className="text-white" />}
        <span
          className={cn(
            "text-[13.5px] font-bold",
            isTop ? "text-white" : "text-text-muted"
          )}
        >
          {RANK_LABELS[rank] ?? `${rank}순위`}
        </span>
      </div>

      <div className="space-y-5 p-4 md:p-6">
        {/* 차량 정보 헤더 */}
        <div className="flex items-center gap-4">
          {/* 썸네일 */}
          <div className="relative h-20 w-28 flex-shrink-0 overflow-hidden rounded-[10px] bg-neutral">
            <ImageWithFallback
              src={detail.thumbnailUrl || detail.imageUrls?.[0]}
              alt={detail.name}
              fill
              sizes="96px"
              className="object-cover"
            />
          </div>

          {/* 이름·트림 */}
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-bold text-text-muted">{detail.brand}</p>
            <h3 className="truncate text-[20px] font-extrabold leading-tight tracking-[-0.03em] text-text-strong">
              {detail.name}
            </h3>
            <p className="text-[13.5px] text-text-muted mt-0.5">{detail.defaultTrimName}</p>
          </div>

          {/* 차량 상세 링크 */}
          <Link
            href={`/cars/${detail.slug}`}
            className="flex-shrink-0 text-text-muted hover:text-brand transition-colors"
            aria-label="차량 상세 보기"
          >
            <ChevronRight size={20} />
          </Link>
        </div>

        {/* AI 해설 */}
        <AiInsight reason={reason} highlights={highlights} />

        {/* 추천 구성 */}
        {hasConfigs && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Users size={13} className="text-brand" />
              <p className="text-[13.5px] font-medium text-text-body">추천 구성</p>
              <span className="rounded-pill bg-brand-soft px-2 py-0.5 text-[12px] font-medium text-brand">
                인기
              </span>
            </div>
            <p className="text-[13px] text-text-muted mb-3">
              필요한 옵션을 선택하면 견적 조건에 함께 반영됩니다.
            </p>

            <div className="space-y-3">
              {detail.popularConfigs.map((config) => (
                <div key={config.id}>
                  {/* 구성 헤더 */}
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13.5px] font-medium text-text-strong">{config.name}</p>
                    {config.note && (
                      <p className="text-[12px] text-text-muted">{config.note}</p>
                    )}
                  </div>

                  {/* 옵션 칩들 */}
                  <div className="flex flex-wrap gap-2">
                    {config.items.map((item) => {
                      const isSelected = selectedItems.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => toggleItem(item.id)}
                          aria-pressed={isSelected}
                          className={cn(
                "inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-all duration-150",
                "active:scale-[0.97]",
                isSelected
                  ? "bg-brand-soft border border-brand text-brand font-bold shadow-sm"
                  : "bg-surface border border-dashed border-border-subtle text-text-body hover:border-solid hover:border-brand/30 hover:text-brand hover:bg-brand-soft/40"
                          )}
                        >
                          <span
                            className={cn(
                              "flex items-center justify-center w-3.5 h-3.5 rounded-full border flex-shrink-0",
                              isSelected
                                ? "bg-brand border-brand"
                                : "border-neutral-400"
                            )}
                          >
                            {isSelected && <Check size={9} className="text-white" />}
                          </span>
                          <span>{item.name}</span>
                          <span
                            className={cn(
                              "text-[13px]",
                              isSelected ? "text-brand" : "text-text-muted"
                            )}
                          >
                            +{Math.round(item.price / 10000)}만
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* 선택 총액 */}
            {selectedTotal > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-[12px] bg-brand/[0.06] border border-brand/15 px-3 py-2">
                <p className="text-[13.5px] text-brand font-bold">선택 구성 추가금</p>
                <p className="num text-[14px] font-extrabold text-brand">
                  +{formatCurrency(selectedTotal)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 월 납입금 예상 — 3가지 견적 비교 */}
        <div>
          <div className="mb-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p className="text-[13.5px] font-medium text-text-body">
                예상 월 납입금 ({months}개월 · 연 {(scenarios.standard.annualMileage / 10_000).toLocaleString("ko-KR")}만km)
              </p>
              {showsRankSurchargeNote && (
                <span className="rounded-pill border border-border-subtle bg-surface-soft px-2 py-0.5 text-[11px] font-bold text-text-muted">
                  금융사 순위 가산 포함
                </span>
              )}
            </div>
            <p className="text-[12px] text-text-muted mt-0.5">
              조건별 월 납입금과 실부담을 함께 비교해 보세요
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* 무보증 */}
            <div className="rounded-[14px] border border-border-subtle bg-surface-soft p-3 flex flex-col gap-1">
              <p className="text-[12px] text-text-muted">무보증</p>
              <TossPrice won={scenarios.standard.monthlyPayment} size="sm" tone="ink" />
              <p className="text-[12px] text-text-muted">보증금·선납금 없음</p>
              <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
                <p className="text-[12px] text-text-muted">{months}개월 실부담</p>
                <p className="text-[13.5px] font-medium text-text-strong">
                  {formatMan(standardTotalCost)}
                </p>
              </div>
            </div>

            {/* 보증금형 + 선납형 — 회원 전용 (비회원은 블러 + 카카오 로그인 유도) */}
            <MemberGate locked={locked} className="sm:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* 보증금형 — 기본 강조 + 추천 배지 */}
            <div className="relative rounded-[14px] border border-brand bg-brand/[0.06] p-3 flex flex-col gap-1">
              <span className="absolute -top-2 right-2 text-[11px] font-bold text-white bg-brand rounded-pill px-2 py-0.5 shadow-sm">
                추천
              </span>
              <p className="text-[12px] text-brand font-bold">보증금 20%</p>
              <TossPrice won={scenarios.conservative.monthlyPayment} size="sm" tone="brand" />
              <p className="text-[12px] text-brand-dark">
                보증금 {formatCurrency(scenarios.conservative.depositAmount)}
              </p>
              <p className="text-[12px] text-brand-dark">계약 종료 시 전액 환급</p>
              <div className="mt-1.5 pt-1.5 border-t border-brand/20">
                <p className="text-[12px] text-brand-dark">{months}개월 실부담</p>
                <p className="num text-[13.5px] font-extrabold text-brand">
                  {formatMan(depositTotalCost)}
                </p>
              </div>
            </div>

            {/* 선납형 */}
            <div className="rounded-[14px] border border-border-subtle bg-surface-soft p-3 flex flex-col gap-1">
              <p className="text-[12px] text-text-muted">선납 30%</p>
              <TossPrice won={scenarios.aggressive.monthlyPayment} size="sm" tone="ink" />
              <p className="text-[12px] text-text-muted">
                선납 {formatCurrency(scenarios.aggressive.prepayAmount)}
              </p>
              <p className="text-[12px] text-text-muted">매월 나눠서 차감</p>
              <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
                <p className="text-[12px] text-text-muted">{months}개월 실부담</p>
                <p className="text-[13.5px] font-medium text-text-strong">
                  {formatMan(prepayTotalCost)}
                </p>
              </div>
            </div>
              </div>
            </MemberGate>
          </div>

          {/* 선납금이 낮아 보이는 이유 안내 */}
          <div className="mt-2.5 rounded-[12px] bg-surface-soft border border-border-subtle px-3 py-2.5">
            <p className="text-[12px] text-text-body leading-relaxed">
              <span className="font-medium">선납금형</span>은 미리 낸 목돈이 매월 나뉘어
              차감되어 월 납입금이 크게 낮아 보일 뿐, 실제로 내는 총액은 무보증과 비슷해요.
              <br />
              <span className="font-bold text-brand">보증금형</span>은 보증금을 계약
              종료 시 돌려받아 {months}개월 실부담이 가장 낮습니다.
            </p>
          </div>

          <p className="text-[12px] text-text-muted mt-2">
            * 실부담 = 월 납입금 합계 + 환급되지 않는 선납금 (보증금 제외). 실제 견적은
            금융사·신용도에 따라 달라질 수 있어요
          </p>
        </div>

        {/* 하단 버튼 — AI셀프 견적내기(메인) / 상담하기(보조) */}
        <div className="space-y-2">
          {/* AI셀프 견적내기 — 메인 강조 */}
          <button
            type="button"
            onClick={handleQuote}
            className="cta-ai public-touch-button w-full"
          >
            <AiBadgeIcon className="h-[16px] w-auto shrink-0" />
            셀프 견적내기
          </button>

          {/* 상담하기 — 보조 (테두리) */}
          <ChannelTalkButton
            vehicleName={detail.name}
            size="sm"
            label="상담하기"
            className="min-h-[44px] w-full !rounded-[12px] !bg-surface-soft !text-text-body border border-border-subtle hover:!bg-brand-soft hover:!text-brand"
          />
        </div>
      </div>
    </div>
  );
}

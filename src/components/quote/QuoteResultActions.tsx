"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  Phone,
  TriangleAlert,
  X,
} from "lucide-react";
import { BottomDockScrim } from "@/components/layout/BottomDockScrim";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { ChannelTalkButton } from "@/components/quote/ChannelTalkButton";
import { NoSalesCallBalloon } from "@/components/ui/NoSalesCallBalloon";
import { openChannelTalk } from "@/lib/channel-talk";
import {
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_TEL_HREF,
} from "@/lib/contact";
import { cn } from "@/lib/utils";

interface QuoteResultDeliveryProps {
  readonly kakaoDeliveryEnabled: boolean;
  readonly channelTalkDelivery: boolean;
  readonly isDelivering: boolean;
  readonly deliverySuccess: boolean;
  readonly deliveryError: string | null;
  readonly onQuoteDeliver: () => void;
  /** 채널톡 경로에서 대화창을 다시 여는 콜백. 창을 닫았거나 붙여넣기를 놓친 고객용. */
  readonly onReopenChannelChat: () => void;
  /** 고객이 "보냈어요"로 전송을 자가 확인했을 때. */
  readonly onConfirmChannelSent: () => void;
  /** 고객이 전송을 확인했는지. 웹에서는 실제 전송 여부를 알 수 없어 자가 신고로 받는다. */
  readonly deliveryConfirmedBySender: boolean;
  /**
   * 상담전환톡이 이미 카카오톡으로 나간 흐름(대기 모드). 붙여넣을 것이 없으므로
   * "아직 안 보냈다" 경고·보냈어요 버튼 대신 받은 메시지의 버튼 안내만 그린다.
   */
  readonly alimtalkDelivery?: boolean;
}

interface QuoteResultActionsProps extends QuoteResultDeliveryProps {
  /** false면 본문에 심사/상담만 두고, 견적서 받기 바는 호출측에서 따로 붙인다. */
  readonly includeDeliveryBar?: boolean;
}

export function hasQuoteResultDelivery(props: {
  readonly kakaoDeliveryEnabled: boolean;
  readonly channelTalkDelivery: boolean;
}): boolean {
  return props.kakaoDeliveryEnabled || props.channelTalkDelivery;
}

/** 견적서 받기 버튼 + 전송 상태. 뷰포트 하단에 고정한다(모바일·데스크톱 공통). */
export function QuoteResultDeliveryBar({
  kakaoDeliveryEnabled,
  channelTalkDelivery,
  isDelivering,
  deliverySuccess,
  deliveryError,
  onQuoteDeliver,
  onReopenChannelChat,
  onConfirmChannelSent,
  deliveryConfirmedBySender,
  alimtalkDelivery = false,
}: QuoteResultDeliveryProps) {
  if (!hasQuoteResultDelivery({ kakaoDeliveryEnabled, channelTalkDelivery })) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="견적서 받기"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 bg-transparent px-5 pt-3",
        DOCK_BOTTOM_PADDING_CLASS,
      )}
    >
      <BottomDockScrim />
      <div className="relative mx-auto flex max-w-[680px] flex-col gap-3">
        {/* 채널톡 경로는 고객이 대화창에 붙여넣고 보내야 비로소 상담사에게 닿는다.
            웹에서는 실제 전송 여부를 알 수 없으므로, 대화창을 연 직후에는 "아직 안 보냈다"고
            안내하고 고객이 '보냈어요'로 직접 넘기게 한다. 연 것만으로 완료처럼 보이면
            기다리다 이탈하고, 보낸 뒤에도 경고가 남으면 불안해진다. */}
        {deliverySuccess ? (
          channelTalkDelivery && alimtalkDelivery ? (
            // 상담전환톡 흐름 — 이미 카카오톡으로 안내가 나갔다. 붙여넣기 지시를 섞으면
            // 고객이 무엇을 해야 하는지 알 수 없게 되므로 받은 메시지의 버튼만 가리킨다.
            <p
              role="status"
              className="flex items-start gap-2 rounded-[12px] border border-brand/20 bg-brand-soft p-3 text-[12px] font-semibold text-brand"
            >
              <CheckCircle2 aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
              <span>
                카카오톡으로 안내 메시지를 보냈어요. 메시지의 「견적서 받기」 버튼을
                누르시면 견적서를 바로 보내드려요.
              </span>
            </p>
          ) : channelTalkDelivery ? (
            <div
              className={`space-y-2 rounded-[12px] border p-3 ${
                deliveryConfirmedBySender
                  ? "border-brand/20 bg-brand-soft"
                  : "border-status-warning/25 bg-status-warning-soft"
              }`}
            >
              {deliveryConfirmedBySender ? (
                <p
                  role="status"
                  className="flex items-start gap-2 text-[12px] font-semibold text-brand"
                >
                  <CheckCircle2 aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
                  <span>
                    요청을 접수했어요. 상담사가 확인 후 카카오톡으로 견적서를 보내드려요.
                  </span>
                </p>
              ) : (
                <p
                  role="status"
                  className="flex items-start gap-2 text-[12px] font-semibold text-status-warning"
                >
                  <TriangleAlert aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
                  <span>
                    아직 보내지 않았어요. 카카오톡 대화창에 붙여넣기(길게 눌러 붙여넣기) 후
                    전송해 주셔야 상담사가 견적서를 보내드려요.
                  </span>
                </p>
              )}

              <div className={deliveryConfirmedBySender ? "" : "grid grid-cols-2 gap-2"}>
                {deliveryConfirmedBySender ? null : (
                  <button
                    type="button"
                    onClick={onConfirmChannelSent}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-btn bg-status-warning px-3 text-[13px] font-bold text-white transition-colors duration-state hover:brightness-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
                  >
                    <CheckCircle2 aria-hidden="true" size={15} />
                    보냈어요
                  </button>
                )}
                <button
                  type="button"
                  onClick={onReopenChannelChat}
                  className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-btn border bg-surface px-3 text-[13px] font-bold transition-colors duration-state focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] ${
                    deliveryConfirmedBySender
                      ? "w-full border-brand/25 text-brand hover:bg-brand-soft"
                      : "border-status-warning/30 text-status-warning hover:bg-surface-soft"
                  }`}
                >
                  <ExternalLink aria-hidden="true" size={15} />
                  대화창 다시 열기
                </button>
              </div>
            </div>
          ) : (
            <p
              role="status"
              className="flex items-start gap-2 rounded-[12px] border border-brand/20 bg-brand-soft p-3 text-[12px] font-semibold text-brand"
            >
              <CheckCircle2 aria-hidden="true" size={14} className="mt-0.5 shrink-0" />
              카카오톡으로 견적서를 보냈어요. 아임딜러 채널 알림톡에서 확인해 주세요.
            </p>
          )
        ) : null}

        {deliveryError ? (
          <p
            role="alert"
            className="rounded-[12px] border border-status-danger/20 bg-status-danger-soft p-3 text-[13px] font-semibold text-status-danger"
          >
            {deliveryError}
          </p>
        ) : null}

        <div className="relative">
          {/* 전송 전에만 보이는 안심 말풍선. 전송 중·완료·에러 상태 메시지와는 겹치지 않게 숨긴다. */}
          {!isDelivering && !deliverySuccess && !deliveryError ? (
            <NoSalesCallBalloon />
          ) : null}
          <button
            type="button"
            onClick={onQuoteDeliver}
            disabled={isDelivering}
            aria-busy={isDelivering}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-[var(--color-kakao-action)] px-5 text-[15px] font-extrabold text-[var(--color-kakao-ink)] shadow-card transition-colors duration-state hover:bg-[var(--color-kakao-action-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
          >
            <KakaoBubbleIcon />
            {isDelivering
              ? channelTalkDelivery
                ? "요청 준비 중…"
                : "전송 중…"
              : "카카오톡으로 견적서 받기"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuoteResultActions({
  includeDeliveryBar = true,
  ...deliveryProps
}: QuoteResultActionsProps) {
  const [reviewModalOpen, setReviewModalOpen] = useState(false);

  return (
    <>
      {includeDeliveryBar ? <QuoteResultDeliveryBar {...deliveryProps} /> : null}

      <section aria-label="견적 결과 actions" className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setReviewModalOpen(true)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn bg-brand px-3 text-[14px] font-extrabold text-white transition-colors duration-state hover:bg-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
          >
            <ClipboardCheck aria-hidden="true" size={17} />
            심사 요청하기
          </button>

          <ChannelTalkButton
            label="상담하기"
            className="min-h-12 rounded-btn px-3 text-[14px]"
          />
        </div>

        {reviewModalOpen ? (
          <DocumentReviewComingSoonModal onClose={() => setReviewModalOpen(false)} />
        ) : null}
      </section>
    </>
  );
}

function DocumentReviewComingSoonModal({ onClose }: { readonly onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [],
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    }, 0);

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-text-strong/65 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="doc-review-coming-soon-title"
        className="relative w-full max-w-[400px] overflow-hidden rounded-card-lg border border-border-subtle bg-surface p-5 shadow-modal sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="닫기"
          onClick={onClose}
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
        >
          <X size={16} strokeWidth={2.3} />
        </button>

        <div className="pr-8">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.06em] text-brand">
            COMING SOON
          </p>
          <h2
            id="doc-review-coming-soon-title"
            className="mt-1.5 text-[18px] font-extrabold tracking-[-0.02em] text-text-strong sm:text-[20px]"
          >
            서류 심사 서비스는 준비 중이에요
          </h2>
          <p className="mt-2 text-[14px] font-medium leading-6 text-text-body">
            곧 온라인으로 바로 이어질 예정이에요. 지금은 대표전화 또는 상담으로 도와드릴게요.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <a
            href={SUPPORT_PHONE_TEL_HREF}
            aria-label={`${SUPPORT_PHONE_DISPLAY} 전화 걸기`}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-btn bg-brand px-3 text-[14px] font-extrabold text-white transition-colors duration-state hover:bg-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
          >
            <Phone aria-hidden="true" size={17} strokeWidth={2.3} />
            대표전화
          </a>
          <ChannelTalkButton
            label="상담하기"
            className="min-h-12 rounded-btn px-3 text-[14px]"
            onClick={() => {
              openChannelTalk();
              onClose();
            }}
          />
        </div>
        <p className="mt-3 text-center text-[12px] font-bold tabular-nums text-text-muted">
          {SUPPORT_PHONE_DISPLAY}
        </p>
      </div>
    </div>
  );
}

function KakaoBubbleIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M10 2.5c-4.14 0-7.5 2.56-7.5 5.72 0 2.02 1.42 3.8 3.55 4.8l-.58 2.12c-.1.36.12.5.42.32l2.62-1.62c.49.07.99.1 1.49.1 4.14 0 7.5-2.56 7.5-5.72S14.14 2.5 10 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

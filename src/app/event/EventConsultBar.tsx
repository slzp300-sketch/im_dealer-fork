"use client";

import { useState } from "react";
import { BottomDockScrim } from "@/components/layout/BottomDockScrim";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { NoSalesCallBalloon } from "@/components/ui/NoSalesCallBalloon";
import { cn } from "@/lib/utils";
import { EventPromoModal } from "./EventPromoModal";

/** 이벤트 페이지 하단 고정 카카오 상담 바. 클릭 시 프로모션 모달을 거쳐 상담을 연다. */
export function EventConsultBar() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div
      role="region"
      aria-label="카카오톡 상담"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 bg-transparent px-5 pt-3",
        DOCK_BOTTOM_PADDING_CLASS,
      )}
    >
      <BottomDockScrim />
      <div className="relative mx-auto flex max-w-[680px] flex-col gap-3">
        <div className="relative">
          <NoSalesCallBalloon />
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            aria-label="카카오톡으로 상담하기"
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-btn bg-[var(--color-kakao-action)] px-5 text-[15px] font-extrabold text-[var(--color-kakao-ink)] shadow-card transition-colors duration-state hover:bg-[var(--color-kakao-action-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
          >
            <KakaoBubbleIcon />
            카카오톡으로 상담하기
          </button>
        </div>
      </div>

      <EventPromoModal open={modalOpen} onClose={() => setModalOpen(false)} />
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

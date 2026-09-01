"use client";

import { MessageCircle } from "lucide-react";
import { BottomDockScrim } from "@/components/layout/BottomDockScrim";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { NoSalesCallBalloon } from "@/components/ui/NoSalesCallBalloon";
import { cn } from "@/lib/utils";
import { openEventConsult } from "./openEventConsult";

/** 이벤트 페이지에서 실시간 상담을 여는 하단 고정 CTA 바. */
export function EventQuoteBar() {
  return (
    <div
      role="region"
      aria-label="실시간 문의하기"
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
            onClick={() => openEventConsult({ source: "/event" })}
            className="cta-ai inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-btn px-5 text-[15px] transition-colors duration-state focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
          >
            <MessageCircle
              aria-hidden="true"
              size={17}
              className="h-[17px] w-auto shrink-0"
            />
            실시간 문의하기
          </button>
        </div>
      </div>
    </div>
  );
}

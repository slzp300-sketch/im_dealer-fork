import Link from "next/link";
import { BottomDockScrim } from "@/components/layout/BottomDockScrim";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { NoSalesCallBalloon } from "@/components/ui/NoSalesCallBalloon";
import { AiBadgeIcon } from "@/components/ui/AiBadgeIcon";
import { cn } from "@/lib/utils";

/** 이벤트 페이지 하단 고정 CTA 바. 홈 히어로와 같은 AI 셀프 견적내기(/cars)로 보낸다. */
export function EventQuoteBar() {
  return (
    <div
      role="region"
      aria-label="AI 셀프 견적내기"
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 bg-transparent px-5 pt-3",
        DOCK_BOTTOM_PADDING_CLASS,
      )}
    >
      <BottomDockScrim />
      <div className="relative mx-auto flex max-w-[680px] flex-col gap-3">
        <div className="relative">
          <NoSalesCallBalloon />
          <Link
            href="/cars"
            className="cta-ai inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-btn px-5 text-[15px] transition-colors duration-state focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
          >
            <AiBadgeIcon className="h-[17px] w-auto shrink-0" />
            셀프 견적내기
          </Link>
        </div>
      </div>
    </div>
  );
}

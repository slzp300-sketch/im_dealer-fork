"use client";

import { useEffect } from "react";
import { MessageCircle, X } from "lucide-react";

interface ConsultSentNoticeProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 모바일 회원이 「상담하기」를 눌러 CONSULT_REQUEST 알림톡이 발송된 뒤 보여주는 안내.
 * 카카오톡으로 상담 안내를 보냈으니 메시지의 「상담 시작하기」 버튼을 눌러달라고 알린다.
 */
export function ConsultSentNotice({ open, onClose }: ConsultSentNoticeProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="상담 안내 발송 완료"
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-sm rounded-card border border-border-subtle bg-surface-raised p-5 shadow-mobile-float"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
        >
          <X size={16} strokeWidth={2.4} />
        </button>

        <div className="flex flex-col items-center gap-3 pt-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-channeltalk-soft)] text-[var(--color-channeltalk-action)]">
            <MessageCircle size={24} strokeWidth={2.1} />
          </span>
          <p className="text-[15px] font-bold text-text-strong">
            카카오톡을 확인해 주세요
          </p>
          <p className="text-[13px] font-semibold leading-relaxed text-text-muted">
            카카오톡으로 상담 안내를 보냈어요. 메시지의 「상담 시작하기」 버튼을 눌러주세요.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-1 w-full rounded-btn bg-[var(--color-channeltalk-action)] px-6 py-3 text-sm font-bold text-[var(--color-channeltalk-ink)] transition-colors hover:bg-[var(--color-channeltalk-action-hover)]"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}

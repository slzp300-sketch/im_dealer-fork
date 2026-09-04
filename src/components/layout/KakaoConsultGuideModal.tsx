"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle, X } from "lucide-react";
import { openKakaoChannelChat } from "@/lib/kakao/channel-add";

interface KakaoConsultGuideModalProps {
  open: boolean;
  onClose: () => void;
}

const FOCUSABLE_QUERY =
  "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/** 모바일 공통 상담 진입 안내. 로그인 상태와 무관하게 카카오 채널로 연결한다. */
export function KakaoConsultGuideModal({
  open,
  onClose,
}: KakaoConsultGuideModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [connectionFailed, setConnectionFailed] = useState(false);
  const handleClose = useCallback(() => {
    setConnectionFailed(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_QUERY)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_QUERY) ?? [],
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [open, handleClose]);

  if (!open || typeof document === "undefined") return null;

  function handleConfirm() {
    if (openKakaoChannelChat()) {
      handleClose();
      return;
    }
    setConnectionFailed(true);
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="상담 안내 닫기"
        onClick={handleClose}
        className="absolute inset-0 cursor-default bg-text-strong/55 backdrop-blur-[2px]"
      />

      <div
        ref={dialogRef}
        className="relative w-full overflow-hidden rounded-t-[24px] border border-border-subtle bg-surface px-5 pb-[max(24px,env(safe-area-inset-bottom,24px))] pt-5 shadow-modal sm:max-w-[400px] sm:rounded-[24px] sm:p-6"
      >
        <button
          type="button"
          onClick={handleClose}
          aria-label="닫기"
          className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
        >
          <X size={18} strokeWidth={2.3} />
        </button>

        <div className="pr-12">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-[16px] bg-[var(--color-kakao-action)] text-[var(--color-kakao-ink)] shadow-card">
            <MessageCircle size={23} strokeWidth={2.2} />
          </span>
          <h2
            id={titleId}
            className="mt-4 break-keep text-[20px] font-extrabold tracking-[-0.025em] text-text-strong"
          >
            카카오톡에서 상담을 시작할게요
          </h2>
        </div>

        <p className="mt-2 break-keep text-[14px] font-medium leading-6 text-text-body">
          회원가입이나 로그인 없이 아임딜러 카카오톡 채널에서 바로 상담할 수 있어요.
        </p>

        <div className="mt-4 rounded-[14px] bg-surface-soft px-4 py-3">
          <p className="text-[12px] font-bold text-text-muted">연결 후 이렇게 이용해 주세요</p>
          <p className="mt-1 break-keep text-[13px] font-semibold leading-5 text-text-body">
            궁금한 차량과 계약 조건을 메시지로 남기면 담당자가 확인 후 답변해 드립니다.
          </p>
        </div>

        {connectionFailed ? (
          <p role="alert" className="mt-3 text-[13px] font-bold text-error-text">
            카카오 채널 연결 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.
          </p>
        ) : null}

        <button
          type="button"
          onClick={handleConfirm}
          className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--color-kakao-action)] px-5 text-[15px] font-extrabold text-[var(--color-kakao-ink)] transition-colors hover:bg-[var(--color-kakao-action-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]"
        >
          <MessageCircle size={18} strokeWidth={2.2} />
          카카오톡 상담 시작하기
        </button>
      </div>
    </div>,
    document.body,
  );
}

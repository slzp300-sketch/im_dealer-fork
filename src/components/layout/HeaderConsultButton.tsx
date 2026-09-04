"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Headset, MessageCircle, Phone, X } from "lucide-react";
import {
  isChannelTalkSuppressedPath,
  openChannelTalk,
} from "@/lib/channel-talk";
import { isMobileDevice } from "@/lib/browser/device";
import {
  isChannelTalkEnabled,
  useChannelTalkStatus,
} from "@/lib/channel-talk-status";
import { SUPPORT_PHONE_DISPLAY, SUPPORT_PHONE_TEL_HREF } from "@/lib/contact";
import { cn } from "@/lib/utils";
import { KakaoConsultGuideModal } from "@/components/layout/KakaoConsultGuideModal";

/**
 * 헤더 우측 통합 상담 버튼.
 * 모바일은 카카오 채널 안내를, 데스크톱은 채널톡·전화 상담 패널을 보여준다.
 * 전화 항목은 행 자체가 tel: 링크라 한 번 탭으로 바로 발신된다.
 */
export function HeaderConsultButton() {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [kakaoGuideOpen, setKakaoGuideOpen] = useState(false);
  const consultRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // /verify 등 채널톡 위젯이 shutdown 되는 경로에서는 채널톡 항목을 숨긴다.
  // 전화번호는 그대로 노출해 본인확인 중에도 전화 상담은 가능하게 둔다.
  const channelTalkSuppressed = isChannelTalkSuppressedPath(pathname);
  const channelTalkEnabled = isChannelTalkEnabled(useChannelTalkStatus());

  // 키보드·닫기 버튼으로 닫을 때는 트리거로 포커스를 되돌려 탐색 위치를 잃지 않게 한다.
  const closeAndRestoreFocus = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);
  const closeKakaoGuide = useCallback(() => setKakaoGuideOpen(false), []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        consultRef.current &&
        !consultRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeAndRestoreFocus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, closeAndRestoreFocus]);

  function handleChannelTalk() {
    if (!channelTalkEnabled) return;
    openChannelTalk();
    setOpen(false);
  }

  function handleTriggerClick() {
    if (isMobileDevice()) {
      setOpen(false);
      setKakaoGuideOpen(true);
      return;
    }
    setOpen((current) => !current);
  }

  return (
    // 패널은 이 래퍼가 아니라 Header 의 헤더 바(relative 컨테이너)를 기준으로 정렬된다.
    // 버튼 기준으로 잡으면 좁은 화면에서 왼쪽으로 넘쳐 별도 보정이 필요하기 때문이다.
    <div ref={consultRef}>
      <button
        type="button"
        ref={triggerRef}
        onClick={handleTriggerClick}
        className="flex min-h-11 items-center gap-1.5 rounded-pill bg-[var(--color-channeltalk-action)] px-3.5 text-[13px] font-bold text-[var(--color-channeltalk-ink)] transition-colors hover:bg-[var(--color-channeltalk-action-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface sm:gap-2 sm:px-4 sm:text-[14px]"
        aria-label="상담하기"
        aria-controls="header-consult-panel"
        aria-expanded={open || kakaoGuideOpen}
      >
        <Headset size={18} strokeWidth={2.2} />
        상담하기
      </button>

      {open && (
        <div
          id="header-consult-panel"
          role="menu"
          aria-label="상담 방법"
          className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-card border border-border-subtle bg-surface-raised p-2 shadow-mobile-float"
        >
          <button
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="상담 메뉴 닫기"
            className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
          >
            <X size={16} strokeWidth={2.4} />
          </button>

          <p className="px-2 pb-1 pt-2 text-[12px] font-bold text-text-muted">
            편하신 방법으로 상담해 주세요
          </p>

          {!channelTalkSuppressed && (
            <button
              type="button"
              role="menuitem"
              onClick={handleChannelTalk}
              disabled={!channelTalkEnabled}
              title={channelTalkEnabled ? undefined : "잠시 후 다시"}
              className={cn(
                "flex w-full items-center gap-3 rounded-btn px-2 py-2.5 text-left transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40",
                !channelTalkEnabled && "cursor-wait opacity-70",
              )}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-channeltalk-soft)] text-[var(--color-channeltalk-action)]">
                <MessageCircle size={19} strokeWidth={2.1} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-bold text-text-strong">
                  {channelTalkEnabled ? "채널톡 상담하기" : "채팅 준비 중"}
                </span>
                <span className="block text-[12px] font-semibold text-text-muted">
                  로그인 없이도 가능해요!
                </span>
              </span>
            </button>
          )}

          <a
            role="menuitem"
            href={SUPPORT_PHONE_TEL_HREF}
            onClick={() => setOpen(false)}
            aria-label={`전화 상담하기 ${SUPPORT_PHONE_DISPLAY}`}
            className="flex w-full items-center gap-3 rounded-btn px-2 py-2.5 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
              <Phone size={19} strokeWidth={2.1} />
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-text-strong">
                전화 상담하기
              </span>
              <span className="block text-[12px] font-semibold text-text-muted">
                {SUPPORT_PHONE_DISPLAY} · 바로 연결돼요
              </span>
            </span>
          </a>
        </div>
      )}

      <KakaoConsultGuideModal
        open={kakaoGuideOpen}
        onClose={closeKakaoGuide}
      />
    </div>
  );
}

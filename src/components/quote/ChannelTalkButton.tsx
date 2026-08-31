"use client";

import { MessageCircle } from "lucide-react";
import { openChannelTalk } from "@/lib/channel-talk";
import {
  isChannelTalkEnabled,
  useChannelTalkStatus,
} from "@/lib/channel-talk-status";
import { cn } from "@/lib/utils";

interface ChannelTalkButtonProps {
  vehicleName?: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  onClick?: () => void;
  loading?: boolean;
}

export function ChannelTalkButton({
  vehicleName,
  label,
  className,
  size = "md",
  onClick,
  loading = false,
}: ChannelTalkButtonProps) {
  const channelTalkStatus = useChannelTalkStatus();
  const enabled = isChannelTalkEnabled(channelTalkStatus);
  const handleClick = () => {
    if (!enabled) return;
    if (onClick) {
      onClick();
      return;
    }
    if (!openChannelTalk()) {
      console.warn("채널톡이 로드되지 않았습니다.");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading || !enabled}
      aria-busy={loading}
      title={enabled ? undefined : "잠시 후 다시"}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-btn font-bold",
        // 채널톡 로고 보라 — 채널톡 진입 버튼 공통 브랜드 색 (globals.css 토큰)
        "bg-[var(--color-channeltalk-action)] text-[var(--color-channeltalk-ink)] transition-colors duration-200 hover:bg-[var(--color-channeltalk-action-hover)]",
        (loading || !enabled) && "cursor-wait opacity-70",
        size === "md" ? "px-6 py-3 text-sm w-full" : "px-4 py-2 text-[13px]",
        className
      )}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      ) : (
        <MessageCircle size={size === "md" ? 16 : 14} />
      )}
      {!enabled
        ? "채팅 준비 중"
        : loading
          ? "요청 저장 중…"
          : label ?? (vehicleName ? `${vehicleName} 상담하기` : "전문가와 상담하기")}
    </button>
  );
}

"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { openChannelTalk } from "@/lib/channel-talk";
import { isMobileDevice } from "@/lib/browser/device";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";

/** 고객이 대화창에 붙여넣을 문구. 상담사가 어떤 견적인지 바로 찾도록 견적번호를 넣는다. */
export function buildQuoteConsultMessage(vehicleName: string, deliveryId: string): string {
  return `[견적 문의] ${vehicleName}\n견적서 확인했습니다. 상담 부탁드립니다.\n견적번호: ${deliveryId}`;
}

interface QuoteDeliveryConsultButtonProps {
  readonly vehicleName: string;
  readonly deliveryId: string;
}

/**
 * 견적서 알림톡에는 상담톡 전환 버튼이 없다(승인된 템플릿이라 버튼을 못 바꾼다).
 * 그래서 알림톡 링크가 착지하는 이 화면에서 대화를 연다.
 *
 * 카카오는 대화 프리필을 지원하지 않으므로 문구를 복사해 두고 붙여넣기를 안내한다.
 * 복사가 막히는 인앱 브라우저가 있어 문구 자체도 화면에 남긴다.
 */
export function QuoteDeliveryConsultButton({
  vehicleName,
  deliveryId,
}: QuoteDeliveryConsultButtonProps) {
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);

  const handleClick = () => {
    const text = buildQuoteConsultMessage(vehicleName, deliveryId);
    // await 를 걸면 사용자 제스처가 만료돼 window.open 이 팝업 차단에 막힌다.
    void navigator.clipboard?.writeText(text).catch(() => {});

    const chatUrl = kakaoChannelChatUrl();
    const opened =
      isMobileDevice() && chatUrl
        ? Boolean(window.open(chatUrl, "_blank", "noopener,noreferrer"))
        : openChannelTalk();
    // 팝업이 막혔거나 채널톡이 아직 안 떴으면 같은 탭에서라도 대화창으로 보낸다.
    if (!opened && chatUrl) window.location.href = chatUrl;

    setCopiedMessage(text);
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleClick}
        className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] border border-brand bg-brand-soft px-5 text-[15px] font-extrabold text-brand transition-colors hover:bg-brand hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/30"
      >
        <MessageCircle size={17} />
        담당자에게 문의하기
      </button>

      {copiedMessage ? (
        <div className="mt-3 rounded-[14px] border border-border-subtle bg-surface px-4 py-3 shadow-card">
          <p className="break-keep text-[13px] font-bold text-text-strong">
            문의 문구를 복사했습니다. 대화창에 붙여넣어 보내주세요.
          </p>
          <p className="mt-2 select-all whitespace-pre-line break-keep text-[13px] leading-relaxed text-text-muted">
            {copiedMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}

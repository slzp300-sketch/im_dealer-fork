import {
  openChannelTalk,
  trackEventConsultation,
  type EventConsultContext,
} from "@/lib/channel-talk";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";

export function openEventConsult(context: EventConsultContext): void {
  trackEventConsultation(context);

  const url = kakaoChannelChatUrl();
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  openChannelTalk();
}

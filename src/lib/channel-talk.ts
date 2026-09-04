import { isMobileDevice } from "@/lib/browser/device";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";

export interface ChannelTalkQuoteContext {
  quoteId: string;
  sessionId: string;
  vehicleName: string;
  trimName: string;
  productType: "장기렌트" | "리스";
  contractMonths: number;
  annualMileage: number;
}

// 같은 문서에서 실행되는 제3자 스크립트는 주민등록번호 입력 필드와 DOM 에 접근할 수 있다.
const CHANNEL_TALK_SUPPRESSED_PREFIXES = ["/verify"] as const;

export function isChannelTalkSuppressedPath(pathOrUrl: string): boolean {
  const pathname = pathOrUrl.split(/[?#]/)[0] ?? "";
  return CHANNEL_TALK_SUPPRESSED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

// 모바일 전면 카카오 전환을 켤지(접속 환경별 분리). 기본 꺼짐 — 지금은 모바일도
// PC 처럼 채널톡 위젯을 열어 인사말이 나가게 한다. 카카오 직결은 모바일에서 새 상담이
// 안 열려(기존 대화방) 상담 시작 안내가 안 나가는 문제가 있어, 세션 링크/알림톡 등
// 대안이 준비되면 env 로 다시 켠다.
function isMobileKakaoDirectEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MOBILE_KAKAO_DIRECT === "true";
}

// 모바일은 채널톡 위젯 대신 카카오 채널 대화방으로 보낸다(플래그로 켜야 동작). 반드시
// 클릭 핸들러에서 동기적으로 window.open 해야 팝업 차단을 피한다. 팝업이 막히면 같은 탭
// 이동으로 폴백한다. 카카오 URL 미설정이면 false 로 위젯에 맡긴다.
function openKakaoChat(): boolean {
  const url = kakaoChannelChatUrl();
  if (!url) return false;
  const opened = Boolean(window.open(url, "_blank", "noopener,noreferrer"));
  if (!opened) window.location.href = url;
  return true;
}

export function openChannelTalk(): boolean {
  if (typeof window === "undefined") return false;
  // 모바일 카카오 직결(플래그 ON)일 때만 카카오로. 그 외(기본)는 채널톡 위젯.
  if (isMobileKakaoDirectEnabled() && isMobileDevice() && openKakaoChat()) return true;
  if (!window.ChannelIO) return false;

  window.ChannelIO("showMessenger");
  return true;
}

export function openChannelTalkWithQuote(context: ChannelTalkQuoteContext): boolean {
  if (typeof window === "undefined") return false;
  // 모바일 카카오 직결(플래그 ON)일 때만 카카오로. track 은 웹 위젯(브라우저) 식별
  // 기준이라 카카오(별도 식별)엔 안 붙어 이 경로에선 생략한다.
  if (isMobileKakaoDirectEnabled() && isMobileDevice() && openKakaoChat()) return true;
  if (!window.ChannelIO) return false;

  window.ChannelIO("track", "quote_consultation_requested", context);
  window.ChannelIO("showMessenger");
  return true;
}

// 카카오 채널로 견적서를 요청할 때, 상담사가 채널톡 데스크에서 볼 견적 컨텍스트를 남긴다.
// (고객은 카카오 채널로 메시지를 보내고, 채널톡↔카카오 연동으로 상담이 뜬다.)
export function trackQuoteDeliveryRequested(context: ChannelTalkQuoteContext): void {
  if (typeof window === "undefined" || !window.ChannelIO) return;
  window.ChannelIO("track", "quote_delivery_requested", context);
}

// 고객이 "보냈어요"로 전송을 자가 확인했을 때. 요청만 하고 실제로 안 보낸 고객과
// 구분되어, 상담사가 미전송 건에 먼저 연락할 수 있다.
export function trackQuoteDeliverySent(context: ChannelTalkQuoteContext): void {
  if (typeof window === "undefined" || !window.ChannelIO) return;
  window.ChannelIO("track", "quote_delivery_sent", context);
}

export interface EventConsultContext {
  source: "/event";
  vehicleName?: string;
  trimName?: string;
  monthlyPrice?: string;
  discount?: string;
}

// /event 특판 페이지에서 카카오 채널 상담으로 보내기 직전에, 고객이 보고 있던
// 차량 컨텍스트를 남긴다. 카카오 채널 링크 자체는 데이터를 실을 수 없지만
// 채널톡↔카카오 연동으로 상담사가 데스크에서 이 이벤트를 보고 어떤 차량 문의인지 안다.
export function trackEventConsultation(context: EventConsultContext): void {
  if (typeof window === "undefined" || !window.ChannelIO) return;
  window.ChannelIO("track", "event_consultation", {
    promotion: "장기렌트 오픈 한정 특별판매",
    ...context,
  });
}

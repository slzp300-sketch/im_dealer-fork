// 알림톡 템플릿 정의. **검수 승인된 템플릿과 본문이 글자 단위로 일치해야** 발송이 성공한다
// (불일치 시 resultCode 3016/3027/3028, 재시도해도 무의미). 그래서 본문·버튼을 한 파일에
// 모아 단일 소스로 관리하고, 비즈톡센터에 등록할 원문(`draft`)도 함께 둔다.
//
// 등록 원문의 `#{변수}` 자리에 값을 채운 결과가 buildMessage 의 반환값이어야 한다.

import type {
  AlimtalkChannelAddButton,
  AlimtalkConsultButton,
  AlimtalkWebLinkButton,
} from "./types";

export type AlimtalkTemplateKey =
  | "QUOTE_DELIVERED"
  | "QUOTE_CONSULT"
  | "REVIEW_REQUEST"
  | "SIGNUP_COMPLETED";

/** 비즈톡센터에 등록할 원문. 검수 접수 시 이 문자열을 그대로 붙여넣는다. */
export const QUOTE_DELIVERED_DRAFT = `[아임딜러] 견적서 도착 안내

#{고객명}님, 요청하신 견적서가 준비되었습니다.

■ 차량: #{차량명} #{트림명}
■ 상품: #{상품유형} · #{계약기간}개월 · 연 #{약정거리}km
■ 월 납입금: #{월납입금}원 (#{금융사} 기준)

아래 버튼에서 견적서 전체 내용을 확인하실 수 있습니다.

※ 본 메시지는 견적서 발송을 요청하신 고객님께 발송되는 안내입니다.`;

export interface QuoteDeliveredVars {
  고객명: string;
  차량명: string;
  트림명: string;
  상품유형: string;
  계약기간: number;
  약정거리: number;
  월납입금: number;
  금융사: string;
  /** 버튼 링크. 프로토콜(https://)까지 포함된 완성 URL 이어야 한다. */
  링크: string;
}

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

/** 사용자 조작 가능 값(카카오 프로필명 등)의 개행·제어문자 제거. 본문 불일치(3016) 예방용. */
function sanitizeTemplateVar(value: string, maxLength: number): string {
  const flattened = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (flattened.length > maxLength) return flattened.slice(0, maxLength);
  return flattened;
}

export function buildQuoteDeliveredMessage(v: QuoteDeliveredVars): string {
  // 고객명은 카카오 프로필명이라 사용자가 임의로 길게/개행을 넣을 수 있다.
  // 빈 값이 되면 변수 자리가 사라져 검수 템플릿과 어긋나므로 기본값을 넣는다.
  const 고객명 = sanitizeTemplateVar(v.고객명, 20) || "고객";
  return `[아임딜러] 견적서 도착 안내

${고객명}님, 요청하신 견적서가 준비되었습니다.

■ 차량: ${v.차량명} ${v.트림명}
■ 상품: ${v.상품유형} · ${v.계약기간}개월 · 연 ${won(v.약정거리)}km
■ 월 납입금: ${won(v.월납입금)}원 (${v.금융사} 기준)

아래 버튼에서 견적서 전체 내용을 확인하실 수 있습니다.

※ 본 메시지는 견적서 발송을 요청하신 고객님께 발송되는 안내입니다.`;
}

// 견적서 템플릿은 채널 추가형이라 카카오가 맨 앞에 '채널 추가' 버튼을 고정해 둔다.
// 이 버튼을 빼거나 순서를 바꾸면 등록 내용과 어긋나 3027(버튼 불일치)로 실패한다.
export function buildQuoteDeliveredButtons(
  linkUrl: string,
): [AlimtalkChannelAddButton, AlimtalkWebLinkButton] {
  return [
    { name: "채널 추가", type: "AC" },
    { name: "견적서 확인하기", type: "WL", url_mobile: linkUrl, url_pc: linkUrl },
  ];
}

// ── 상담전환톡 ──────────────────────────────────────────────
// 견적서보다 먼저 나가는 메시지. 고객이 버튼을 눌러 상담이 열린 뒤에야 견적서가
// 발송된다(채널톡 웹훅 → dispatchQuoteDeliveryByRequestCode). 견적서만 받고 이탈해
// 상담이 열리지 않는 문제를 막으려는 구조다.
//
// 월 납입금은 일부러 넣지 않는다 — 금액까지 보여주면 버튼을 누르지 않아도 알고 싶은
// 것을 얻어 상담 유도력이 떨어진다. 금액은 견적서 쪽에 남긴다.

/** 비즈톡센터에 등록할 원문. 검수 접수 시 이 문자열을 그대로 붙여넣는다. */
export const QUOTE_CONSULT_DRAFT = `[아임딜러] 견적서 준비 완료

#{고객명}님, 요청하신 견적서가 준비되었습니다.

■ 차량: #{차량명} #{트림명}
■ 상품: #{상품유형} · #{계약기간}개월 · 연 #{약정거리}km

아래 버튼을 누르시면 견적서를 보내드리고 상담도 바로 이어집니다.

※ 본 메시지는 견적서 발송을 요청하신 고객님께 발송되는 안내입니다.`;

export interface QuoteConsultVars {
  readonly 고객명: string;
  readonly 차량명: string;
  readonly 트림명: string;
  readonly 상품유형: string;
  readonly 계약기간: number;
  readonly 약정거리: number;
}

export function buildQuoteConsultMessage(v: QuoteConsultVars): string {
  const 고객명 = sanitizeTemplateVar(v.고객명, 20) || "고객";
  return `[아임딜러] 견적서 준비 완료

${고객명}님, 요청하신 견적서가 준비되었습니다.

■ 차량: ${v.차량명} ${v.트림명}
■ 상품: ${v.상품유형} · ${v.계약기간}개월 · 연 ${won(v.약정거리)}km

아래 버튼을 누르시면 견적서를 보내드리고 상담도 바로 이어집니다.

※ 본 메시지는 견적서 발송을 요청하신 고객님께 발송되는 안내입니다.`;
}

/**
 * 버튼명은 비즈톡센터 등록값과 글자 단위로 같아야 한다(불일치 시 3027).
 * chat_extra 에 요청번호를 실어, 고객이 버튼만 눌러도 어느 견적서인지 알 수 있게 한다.
 */
export function buildQuoteConsultButtons(requestCode: string): [AlimtalkConsultButton] {
  return [{ name: "견적서 받기", type: "BC", chat_extra: requestCode }];
}

/** 비즈톡센터에 등록할 원문. 검수 접수 시 이 문자열을 그대로 붙여넣는다. */
export const REVIEW_REQUEST_DRAFT = `[아임딜러] 후기 작성 안내

#{고객명}님, 계약이 완료되었습니다.

이용 경험에 대한 후기를 남겨주시면 다른 고객님께 큰 도움이 됩니다.

아래 버튼에서 후기를 작성하실 수 있습니다.

※ 본 메시지는 계약을 완료하신 고객님께 발송되는 안내입니다.`;

export type ReviewRequestVars = {
  readonly 고객명: string;
  /** 버튼 링크. 프로토콜(https://)까지 포함된 완성 URL 이어야 한다. */
  readonly 링크: string;
};

export function buildReviewRequestMessage(v: ReviewRequestVars): string {
  return `[아임딜러] 후기 작성 안내

${v.고객명}님, 계약이 완료되었습니다.

이용 경험에 대한 후기를 남겨주시면 다른 고객님께 큰 도움이 됩니다.

아래 버튼에서 후기를 작성하실 수 있습니다.

※ 본 메시지는 계약을 완료하신 고객님께 발송되는 안내입니다.`;
}

export function buildReviewRequestButtons(linkUrl: string): AlimtalkWebLinkButton[] {
  return [{ name: "후기 작성하기", type: "WL", url_mobile: linkUrl, url_pc: linkUrl }];
}

/** 비즈톡센터에 등록할 원문. 검수 접수 시 이 문자열을 그대로 붙여넣는다. */
export const SIGNUP_COMPLETED_DRAFT = `[아임딜러] 회원가입 완료 안내

#{고객명}님, 아임딜러 회원가입이 완료되었습니다.

■ 가입일: #{가입일}
■ 회원 추천코드: #{추천코드}

아래 버튼에서 내 견적 내역과 회원 정보를 확인하실 수 있습니다.

※ 본 메시지는 회원가입을 완료하신 고객님께 발송되는 안내입니다.`;

export type SignupCompletedVars = {
  readonly 고객명: string;
  readonly 가입일: Date;
  readonly 추천코드: string;
};

const kstDate = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);

export function buildSignupCompletedMessage(v: SignupCompletedVars): string {
  return `[아임딜러] 회원가입 완료 안내

${v.고객명}님, 아임딜러 회원가입이 완료되었습니다.

■ 가입일: ${kstDate(v.가입일)}
■ 회원 추천코드: ${v.추천코드}

아래 버튼에서 내 견적 내역과 회원 정보를 확인하실 수 있습니다.

※ 본 메시지는 회원가입을 완료하신 고객님께 발송되는 안내입니다.`;
}

/**
 * 버튼 링크는 변수 없는 고정 링크로 등록한다. 등록 링크와 발송 링크가 다르면
 * 링크 검증에 걸려 1030 으로 실패하므로 이 상수를 단일 소스로 쓴다.
 */
export const SIGNUP_COMPLETED_MYPAGE_URL = "https://www.imdealer.co.kr/mypage";

export function buildSignupCompletedButtons(): AlimtalkWebLinkButton[] {
  return [
    {
      name: "마이페이지 바로가기",
      type: "WL",
      url_mobile: SIGNUP_COMPLETED_MYPAGE_URL,
      url_pc: SIGNUP_COMPLETED_MYPAGE_URL,
    },
  ];
}

/**
 * 검수 승인 후 부여받은 tmpltCode. 미설정이면 발송을 시도하지 않는다.
 * 코드가 없는 채로 보내면 resultCode 3015(템플릿 없음)로 과금 없이 실패하지만,
 * 큐에 실패 행만 쌓이므로 애초에 적재하지 않는 편이 낫다.
 */
export function getTemplateCode(key: AlimtalkTemplateKey): string | null {
  const code = process.env[`ALIMTALK_TEMPLATE_${key}`]?.trim();
  return code ? code : null;
}

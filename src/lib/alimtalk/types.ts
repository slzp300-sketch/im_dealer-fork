// 앱 ↔ 릴레이(scripts/biztalk-relay) 사이의 계약.
// 릴레이가 이 파일을 직접 import 하므로 Next.js 전용 코드를 넣지 않는다.

/** 알림톡 버튼. 비즈톡 attach.button[] 스펙 중 우리가 쓰는 웹링크(WL)·채널추가(AC)·상담톡전환(BC)만. */
export interface AlimtalkWebLinkButton {
  name: string;
  type: "WL";
  url_mobile: string;
  url_pc: string;
}

/** 채널 추가형 템플릿의 첫 버튼. 카카오가 이름을 "채널 추가"로 고정한다. */
export interface AlimtalkChannelAddButton {
  name: "채널 추가";
  type: "AC";
}

/**
 * 상담톡 전환 버튼. 누르면 카카오 상담톡으로 넘어가 상담이 열린다.
 * chat_extra 는 그때 함께 전달되는 메타정보(Text(50))로, 고객이 아무것도 입력하지
 * 않아도 어느 견적서를 보내야 하는지 잇는 유일한 단서다.
 *
 * 상담톡을 이용하는 채널에서만 동작한다.
 */
export interface AlimtalkConsultButton {
  name: string;
  type: "BC";
  chat_extra: string;
}

export type AlimtalkButton =
  | AlimtalkWebLinkButton
  | AlimtalkChannelAddButton
  | AlimtalkConsultButton;

/** 클레임 응답 — 릴레이가 sendAlimTalk 에 그대로 실어 보낼 수 있는 형태. */
export interface AlimtalkClaimedMessage {
  /** AlimtalkMessage.id. 그대로 msgIdx 로 사용한다. */
  id: string;
  leaseToken: string;
  templateCode: string;
  /** 복호화된 수신번호(01012345678). 본문에도 고객명이 평문으로 들어가므로 릴레이에 키를 두지 않는다. */
  recipient: string;
  message: string;
  buttons: AlimtalkButton[];
  /** 본문에 금액 표기가 있는 템플릿만 채워진다. 통화는 릴레이가 KRW 로 붙인다. */
  price?: number;
}

/** 접수 결과 보고 (sendAlimTalk 응답). */
export interface AlimtalkAcceptReport {
  id: string;
  leaseToken: string;
  responseCode: string;
  msg?: string;
}

/** 전송 결과 보고 (getResultPoll 응답 1건). */
export interface AlimtalkResultReport {
  msgIdx: string;
  resultCode: string;
  sendType?: string;
  uid?: string;
  resultDate?: string;
}

export const ALIMTALK_CLAIM_BATCH = 20;
/** SENDING 상태로 이 시간이 지나면 릴레이가 죽은 것으로 보고 회수한다. */
export const ALIMTALK_LEASE_STALE_MS = 10 * 60 * 1000;
/** 이 횟수만큼 시도했는데도 접수되지 않으면 포기한다. */
export const ALIMTALK_MAX_ATTEMPTS = 3;

import { describe, expect, it } from "vitest";
import {
  QUOTE_CONSULT_DRAFT,
  QUOTE_DELIVERED_DRAFT,
  REVIEW_REQUEST_DRAFT,
  buildQuoteConsultButtons,
  buildQuoteConsultMessage,
  buildQuoteDeliveredButtons,
  buildQuoteDeliveredMessage,
  buildReviewRequestButtons,
  buildReviewRequestMessage,
  SIGNUP_COMPLETED_DRAFT,
  SIGNUP_COMPLETED_MYPAGE_URL,
  buildSignupCompletedButtons,
  buildSignupCompletedMessage,
} from "./templates";

const VARS = {
  고객명: "홍길동",
  차량명: "쏘렌토",
  트림명: "프레스티지",
  상품유형: "리스",
  계약기간: 36,
  약정거리: 20000,
  월납입금: 763500,
  금융사: "오릭스캐피탈",
  링크: "https://www.imdealer.co.kr/quote/delivery/abc",
};

describe("buildQuoteConsultMessage", () => {
  const CONSULT_VARS = {
    고객명: "홍길동",
    차량명: "쏘렌토",
    트림명: "프레스티지",
    상품유형: "리스",
    계약기간: 36,
    약정거리: 20000,
  };

  it("등록 원문의 변수만 치환한 결과와 일치한다", () => {
    const expected = QUOTE_CONSULT_DRAFT.replace("#{고객명}", "홍길동")
      .replace("#{차량명}", "쏘렌토")
      .replace("#{트림명}", "프레스티지")
      .replace("#{상품유형}", "리스")
      .replace("#{계약기간}", "36")
      .replace("#{약정거리}", "20,000");

    expect(buildQuoteConsultMessage(CONSULT_VARS)).toBe(expected);
  });

  it("미치환 변수가 남지 않는다", () => {
    expect(buildQuoteConsultMessage(CONSULT_VARS)).not.toMatch(/#\{/);
  });

  // 금액을 넣으면 등록 내용과 어긋나고, 버튼을 누를 이유도 약해진다.
  it("월 납입금을 담지 않는다", () => {
    expect(buildQuoteConsultMessage(CONSULT_VARS)).not.toMatch(/납입금/);
  });
});

describe("buildQuoteConsultButtons", () => {
  // 버튼명이 센터 등록값과 다르면 3027 로 전량 실패한다.
  it("상담톡 전환 버튼 하나에 요청번호를 실어 보낸다", () => {
    expect(buildQuoteConsultButtons("AB23CD")).toEqual([
      { name: "견적서 받기", type: "BC", chat_extra: "AB23CD" },
    ]);
  });
});

describe("buildQuoteDeliveredMessage", () => {
  // 승인 템플릿과 본문이 글자 단위로 다르면 resultCode 3016 으로 실패하고 재시도해도 소용없다.
  // 등록 원문에서 변수만 값으로 바꾼 결과와 완전히 같아야 한다.
  it("등록 원문의 변수만 치환한 결과와 일치한다", () => {
    const expected = QUOTE_DELIVERED_DRAFT.replace("#{고객명}", "홍길동")
      .replace("#{차량명}", "쏘렌토")
      .replace("#{트림명}", "프레스티지")
      .replace("#{상품유형}", "리스")
      .replace("#{계약기간}", "36")
      .replace("#{약정거리}", "20,000")
      .replace("#{월납입금}", "763,500")
      .replace("#{금융사}", "오릭스캐피탈");

    expect(buildQuoteDeliveredMessage(VARS)).toBe(expected);
  });

  it("미치환 변수가 남지 않는다", () => {
    expect(buildQuoteDeliveredMessage(VARS)).not.toMatch(/#\{/);
  });

  it("고객명의 개행·제어문자는 제거되고 20자로 잘린다", () => {
    const message = buildQuoteDeliveredMessage({
      ...VARS,
      고객명: "첫째\n둘째\t셋째",
    });
    expect(message).toContain("첫째 둘째 셋째님,");
    expect(message).not.toContain("\n\n\n".repeat(1)); // 고객명 줄바꿈이 본문 구조를 깨지 않는다

    const long = buildQuoteDeliveredMessage({ ...VARS, 고객명: "가".repeat(30) });
    expect(long).toContain(`${"가".repeat(20)}님,`);
    expect(long).not.toContain("가".repeat(21));
  });

  it("고객명이 공백만 있으면 기본값으로 보완한다", () => {
    const message = buildQuoteDeliveredMessage({ ...VARS, 고객명: "  \n " });
    expect(message).toContain("고객님,");
  });

  it("본문이 1300자를 넘지 않는다", () => {
    expect(buildQuoteDeliveredMessage(VARS).length).toBeLessThanOrEqual(1300);
  });
});

describe("buildQuoteDeliveredButtons", () => {
  // 버튼 링크에 미치환 변수가 남으면 링크 검증에 걸려 1030 으로 실패한다.
  it("모바일·PC 링크가 완성된 https URL 이다", () => {
    const [channelAdd, button] = buildQuoteDeliveredButtons(VARS.링크);
    // 채널 추가형 템플릿이라 '채널 추가'가 항상 첫 버튼이어야 한다(순서·이름 고정).
    expect(channelAdd).toEqual({ name: "채널 추가", type: "AC" });
    expect(button.type).toBe("WL");
    expect(button.url_mobile).toBe(VARS.링크);
    expect(button.url_pc).toBe(VARS.링크);
    expect(button.url_mobile.startsWith("https://")).toBe(true);
  });
});

const REVIEW_VARS = {
  고객명: "홍길동",
  링크: "https://www.imdealer.co.kr/reviews/write/token-1",
} as const;

describe("buildReviewRequestMessage", () => {
  it("등록 원문의 변수만 치환한 결과와 일치한다", () => {
    const expected = REVIEW_REQUEST_DRAFT.replace("#{고객명}", "홍길동");
    expect(buildReviewRequestMessage(REVIEW_VARS)).toBe(expected);
  });

  it("미치환 변수가 남지 않는다", () => {
    expect(buildReviewRequestMessage(REVIEW_VARS)).not.toMatch(/#\{/);
  });

  it("본문이 1300자를 넘지 않는다", () => {
    expect(buildReviewRequestMessage(REVIEW_VARS).length).toBeLessThanOrEqual(1300);
  });
});

describe("buildReviewRequestButtons", () => {
  it("모바일·PC 링크가 완성된 https URL 이다", () => {
    const [button] = buildReviewRequestButtons(REVIEW_VARS.링크);
    expect(button?.type).toBe("WL");
    expect(button?.name).toBe("후기 작성하기");
    expect(button?.url_mobile).toBe(REVIEW_VARS.링크);
    expect(button?.url_pc).toBe(REVIEW_VARS.링크);
    expect(button?.url_mobile.startsWith("https://")).toBe(true);
  });
});

const SIGNUP_VARS = {
  고객명: "홍길동",
  // 2026-08-21 14:00 KST
  가입일: new Date("2026-08-21T05:00:00.000Z"),
  추천코드: "K4821",
} as const;

describe("buildSignupCompletedMessage", () => {
  it("등록 원문의 변수만 치환한 결과와 일치한다", () => {
    const expected = SIGNUP_COMPLETED_DRAFT.replace("#{고객명}", "홍길동")
      .replace("#{가입일}", "2026년 8월 21일")
      .replace("#{추천코드}", "K4821");

    expect(buildSignupCompletedMessage(SIGNUP_VARS)).toBe(expected);
  });

  it("미치환 변수가 남지 않는다", () => {
    expect(buildSignupCompletedMessage(SIGNUP_VARS)).not.toMatch(/#{/);
  });

  // 서버 TZ 가 UTC 라도 고객이 보는 가입일은 KST 기준이어야 한다.
  it("가입일을 KST 로 표기한다", () => {
    const message = buildSignupCompletedMessage({
      ...SIGNUP_VARS,
      가입일: new Date("2026-08-21T15:30:00.000Z"),
    });
    expect(message).toContain("가입일: 2026년 8월 22일");
  });

  it("본문이 1300자를 넘지 않는다", () => {
    expect(buildSignupCompletedMessage(SIGNUP_VARS).length).toBeLessThanOrEqual(1300);
  });
});

describe("buildSignupCompletedButtons", () => {
  // 변수 없는 고정 링크로 등록하므로 등록 링크와 글자 단위로 같아야 한다.
  it("등록 링크와 동일한 고정 https URL 이다", () => {
    const [button] = buildSignupCompletedButtons();
    expect(button?.type).toBe("WL");
    expect(button?.name).toBe("마이페이지 바로가기");
    expect(button?.url_mobile).toBe(SIGNUP_COMPLETED_MYPAGE_URL);
    expect(button?.url_pc).toBe(SIGNUP_COMPLETED_MYPAGE_URL);
    expect(SIGNUP_COMPLETED_MYPAGE_URL.startsWith("https://")).toBe(true);
  });
});

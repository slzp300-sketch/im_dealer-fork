import { describe, expect, it } from "vitest";
import {
  extractQuoteRequestCode,
  generateQuoteRequestCode,
  REQUEST_CODE_LENGTH,
} from "./request-code";

describe("generateQuoteRequestCode", () => {
  it("헷갈리는 글자(0·O·1·I·L)를 쓰지 않는다", () => {
    // 붙여넣기가 막힌 인앱 브라우저에서 고객이 직접 입력하는 경우가 있다.
    const codes = Array.from({ length: 200 }, () => generateQuoteRequestCode());

    expect(codes.every((code) => code.length === REQUEST_CODE_LENGTH)).toBe(true);
    expect(codes.join("")).not.toMatch(/[01OIL]/);
  });
});

describe("extractQuoteRequestCode", () => {
  const message = (code: string) =>
    `[견적서 요청] 쏘렌토 프레스티지\n장기렌트 · 60개월 · 연 20,000km\n요청번호 ${code}\n견적서 보내주세요.`;

  it("안내 문구를 그대로 보낸 경우를 읽는다", () => {
    expect(extractQuoteRequestCode(message("AB23CD"))).toBe("AB23CD");
  });

  it("앞뒤로 말을 덧붙여도 읽는다", () => {
    expect(extractQuoteRequestCode(`안녕하세요\n${message("XY45ZW")}\n부탁드려요`)).toBe(
      "XY45ZW"
    );
  });

  it("소문자로 입력해도 읽는다", () => {
    expect(extractQuoteRequestCode("요청번호 ab23cd")).toBe("AB23CD");
  });

  it("번호만 보내도 읽는다", () => {
    expect(extractQuoteRequestCode("AB23CD")).toBe("AB23CD");
  });

  it("라벨이 있으면 다른 후보가 섞여도 라벨 쪽을 쓴다", () => {
    expect(extractQuoteRequestCode("PQRS TU 요청번호 AB23CD")).toBe("AB23CD");
  });

  // 어느 견적서를 보낼지 단정할 수 없으면 보내지 않는다 — 오발송이 더 나쁘다.
  it("라벨 없이 후보가 둘이면 null", () => {
    expect(extractQuoteRequestCode("AB23CD 인가요 XY45ZW 인가요")).toBeNull();
  });

  it("더 긴 영숫자 덩어리의 일부는 번호로 보지 않는다", () => {
    expect(extractQuoteRequestCode("주문 AB23CDEF9 확인")).toBeNull();
  });

  it("번호가 없으면 null", () => {
    expect(extractQuoteRequestCode("안녕하세요 견적서 보내주세요")).toBeNull();
  });
});

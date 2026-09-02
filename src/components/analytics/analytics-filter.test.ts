import { describe, expect, it } from "vitest";

import { filterAnalyticsUrl } from "./analytics-filter";

const ORIGIN = "https://imdealer.example";

describe("filterAnalyticsUrl", () => {
  it("일반 경로는 유지하고 쿼리·해시를 제거한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/verify?sessionId=abc123`)).toBe(`${ORIGIN}/verify`);
    expect(filterAnalyticsUrl(`${ORIGIN}/login?ref=KYU12&next=/mypage`)).toBe(`${ORIGIN}/login`);
    expect(filterAnalyticsUrl(`${ORIGIN}/terms#privacy`)).toBe(`${ORIGIN}/terms`);
    expect(filterAnalyticsUrl(`${ORIGIN}/cars/sorento-hev`)).toBe(`${ORIGIN}/cars/sorento-hev`);
  });

  it("리뷰 작성 토큰 세그먼트를 [token]으로 마스킹한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/reviews/write/abc-secret-token`)).toBe(
      `${ORIGIN}/reviews/write/[token]`,
    );
    expect(filterAnalyticsUrl(`${ORIGIN}/reviews/write/tok?x=1`)).toBe(
      `${ORIGIN}/reviews/write/[token]`,
    );
  });

  it("견적서 배달 id 세그먼트를 [id]로 마스킹한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/quote/delivery/clxxx123`)).toBe(
      `${ORIGIN}/quote/delivery/[id]`,
    );
  });

  it("추천인 코드 세그먼트를 [code]로 마스킹한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/r/KYU12`)).toBe(`${ORIGIN}/r/[code]`);
  });

  it("시크릿 세그먼트 뒤에 경로가 더 있으면 마스킹 후 유지한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/reviews/write/tok/extra`)).toBe(
      `${ORIGIN}/reviews/write/[token]/extra`,
    );
  });

  it("prefix와 정확히 같은 경로(세그먼트 없음)는 그대로 둔다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/reviews/write`)).toBe(`${ORIGIN}/reviews/write`);
    expect(filterAnalyticsUrl(`${ORIGIN}/reviews/write/`)).toBe(`${ORIGIN}/reviews/write`);
  });

  it("/admin 트래픽은 드롭한다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/admin`)).toBeNull();
    expect(filterAnalyticsUrl(`${ORIGIN}/admin/vehicles`)).toBeNull();
    expect(filterAnalyticsUrl(`${ORIGIN}/admin?tab=x`)).toBeNull();
  });

  it("/admin로 시작하는 다른 경로는 드롭하지 않는다", () => {
    expect(filterAnalyticsUrl(`${ORIGIN}/administrator`)).toBe(`${ORIGIN}/administrator`);
  });

  it("파싱 불가능한 URL은 드롭한다", () => {
    expect(filterAnalyticsUrl("not-a-url")).toBeNull();
  });
});

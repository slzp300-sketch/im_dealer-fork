"use client";

import { Analytics } from "@vercel/analytics/next";

import { filterAnalyticsUrl } from "./analytics-filter";

/**
 * 루트 레이아웃용 Vercel Analytics 래퍼.
 * 서버 컴포넌트(layout.tsx)에서는 함수 prop을 넘길 수 없어 클라이언트 래퍼로 감싼다.
 * 송신 URL 정리 규칙(어드민 드롭·시크릿 세그먼트 마스킹·쿼리 제거)은
 * analytics-filter.ts가 담당하며 유닛테스트도 거기만 붙는다.
 */
export function SafeAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = filterAnalyticsUrl(event.url);
        return url === null ? null : { ...event, url };
      }}
    />
  );
}

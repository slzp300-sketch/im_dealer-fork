import { describe, expect, it } from "vitest";

import { unexpectedBrowserConsoleErrors } from "../../../e2e/fixtures/vehicle-image-observer-rules";
import { shouldMountVercelAnalytics } from "./analytics-mount";

/**
 * CI 의 로컬 `next start` 가 `/_vercel/insights/script.js` 를 주입하면
 * 플랫폼이 그 경로를 서빙하지 않아 404 HTML 이 오고, Chromium 이 아래 두
 * 콘솔 에러를 남긴다. vehicle-image E2E 의 assertClean() 은 이 메시지를
 * unexpected 로 취급해야 하며, 그래서 Vercel 이 아닌 환경에서는
 * Analytics 를 마운트하면 안 된다.
 */
const INSIGHTS_NOT_FOUND =
  "Failed to load resource: the server responded with a status of 404 (Not Found)";
const INSIGHTS_MIME =
  "Refused to execute script from 'http://127.0.0.1:4173/_vercel/insights/script.js' because its MIME type ('text/html') is not executable.";

describe("shouldMountVercelAnalytics", () => {
  it("CI·로컬 next start(VERCEL 없음)에서는 마운트하지 않는다", () => {
    expect(shouldMountVercelAnalytics({})).toBe(false);
    expect(shouldMountVercelAnalytics({ VERCEL: "" })).toBe(false);
    expect(shouldMountVercelAnalytics({ VERCEL: undefined })).toBe(false);
  });

  it("Vercel 프로덕션·프리뷰(VERCEL=1)에서는 마운트한다", () => {
    expect(shouldMountVercelAnalytics({ VERCEL: "1" })).toBe(true);
  });

  it("VERCEL=1 이외 값은 플랫폼으로 보지 않는다", () => {
    expect(shouldMountVercelAnalytics({ VERCEL: "true" })).toBe(false);
    expect(shouldMountVercelAnalytics({ VERCEL: "0" })).toBe(false);
  });

  it("insights 404/MIME 콘솔 노이즈는 observer 가 그대로 실패로 본다", () => {
    expect(shouldMountVercelAnalytics({})).toBe(false);
    expect(unexpectedBrowserConsoleErrors([INSIGHTS_NOT_FOUND, INSIGHTS_MIME], [])).toEqual([
      INSIGHTS_NOT_FOUND,
      INSIGHTS_MIME,
    ]);
  });
});

/**
 * Vercel Web Analytics 마운트 여부.
 *
 * `@vercel/analytics` 는 production(`next start`)에서 `/_vercel/insights/script.js` 를
 * 주입한다. 그 경로는 Vercel 엣지에서만 서빙되므로, CI·로컬 `next start` 는
 * 404 HTML 을 돌려주고 Chromium 콘솔을 오염시킨다.
 * 플랫폼 시그널은 이 레포의 다른 가드와 같이 `VERCEL === "1"` 만 인정한다.
 */
export function shouldMountVercelAnalytics(
  env: { readonly VERCEL?: string } = { VERCEL: process.env.VERCEL },
): boolean {
  return env.VERCEL === "1";
}

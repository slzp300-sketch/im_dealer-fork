/**
 * Vercel Web Analytics beforeSend용 URL 필터.
 *
 * 루트 <Analytics />는 기본적으로 location.href 전체(쿼리스트링 포함)를 그대로 전송한다.
 * 이 서비스는 민감한 값이 URL에 실리는 페이지가 있어 송신 전에 정리한다:
 * - /reviews/write/[token] — 리뷰 작성 capability 토큰(권한 자체가 URL에 있음)
 * - /quote/delivery/[id]   — 견적서 배달 레코드 id(id로 바로 조회되는 접근 수단)
 * - /r/[code]              — 추천인 코드(route handler라 페이지뷰는 없지만 소프트 내비게이션 대비)
 * - ?sessionId= 등 쿼리 전반 — 본인확인 세션 id, 추천인 코드(ref), next 리다이렉트 경로
 *
 * 쿼리·해시는 기기 비율 집계에 불필요하므로 전부 떼고, /admin 스태프 트래픽은
 * "전체 방문자" 기기 비율 지표를 오염시키므로 이벤트 자체를 드롭한다.
 */

/** 시크릿 세그먼트를 갖는 경로 prefix. mask는 실제 라우트 파라미터명 표기와 같게 둔다. */
const SECRET_PATH_PREFIXES: ReadonlyArray<{ prefix: string; mask: string }> = [
  { prefix: "/reviews/write", mask: "[token]" },
  { prefix: "/quote/delivery", mask: "[id]" },
  { prefix: "/r", mask: "[code]" },
];

const ADMIN_PATH = "/admin";

/** "/administrator" 같은 인접 경로는 경계(/) 기준으로 제외한다. */
function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`);
}

/** 시크릿 prefix 바로 뒤 세그먼트만 치환하고 나머지 경로는 유지한다. 해당 없으면 원 경로 반환. */
function maskSecretPath(pathname: string): string {
  for (const { prefix, mask } of SECRET_PATH_PREFIXES) {
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) continue;
    const rest = pathname.slice(prefix.length); // "" | "/token" | "/token/..."
    if (!rest) return prefix;
    const [, secret = "", ...tail] = rest.split("/");
    return [prefix, secret ? mask : "", ...tail].filter(Boolean).join("/");
  }
  return pathname;
}

/**
 * 수집 전송용 URL을 정리한다. 드롭 대상이면 null, 아니면 origin+마스킹된 경로(쿼리·해시 제거).
 * beforeSend에서 null을 반환하면 이벤트가 전송되지 않는다.
 */
export function filterAnalyticsUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // 파싱조차 안 되는 URL은 원문을 실을 수 없으니 드롭
    return null;
  }
  if (isAdminPath(parsed.pathname)) return null;
  return `${parsed.origin}${maskSecretPath(parsed.pathname)}`;
}

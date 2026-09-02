import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * 이미 열려 있는(사람이 로그인해 둔) Chrome 에 attach 해서 내부 API 를 캡처한다.
 * inspect-capital.mjs 를 백그라운드로 띄운 뒤 재로그인 없이 이어서 정찰할 때 쓴다.
 * 창을 닫지 않고 4초마다 저장하므로, 견적을 내는 동안 언제든 결과를 읽을 수 있다.
 *
 *   node scripts/scraper-worker/attach-capital.mjs <디버깅URL> <baseHost> [출력파일명]
 *   예) node scripts/scraper-worker/attach-capital.mjs http://127.0.0.1:54718 auto.nhcapital.co.kr nh-recon.json
 *
 * 종료: 이 프로세스를 멈추거나(백그라운드 kill) 브라우저를 닫으면 최종 저장.
 * browser 는 disconnect 만 한다(원본 프로세스가 소유 — close 하지 않는다).
 */

const BROWSER_URL = process.argv[2];
const BASE_HOST = (process.argv[3] || "").replace(/^www\./, "");
const OUT_NAME = process.argv[4] || "capital-recon.json";
if (!BROWSER_URL || !BASE_HOST) {
  console.error("사용법: node attach-capital.mjs <디버깅URL> <baseHost> [출력파일명]");
  process.exit(1);
}
const OUT = join(tmpdir(), OUT_NAME);

const IGNORE_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|css|js|map)(\?|$)|google|gstatic|beusable|doubleclick|facebook|hotjar|analytics|sentry|newrelic|kakao\.com|nprotect|raon/i;

function looksLikeApi(url) {
  if (IGNORE_RE.test(url)) return false;
  if (/\/api\/|\.do(\?|$)|\.act(\?|$)|\.nh(\?|$)|\.kbc(\?|$)|\.json(\?|$)|\/rest\/|\/svc\/|graphql|\/gw\//i.test(url)) {
    return true;
  }
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return h.endsWith(BASE_HOST);
  } catch {
    return false;
  }
}

function truncate(s, n = 6000) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n}자)` : s;
}
function pickHeaders(h) {
  const keep = {};
  for (const k of ["content-type", "authorization", "x-requested-with", "referer"]) {
    if (h[k]) keep[k] = h[k];
  }
  return keep;
}

const captures = [];

function attachToPage(page) {
  page.on("request", (req) => {
    const url = req.url();
    const type = req.resourceType();
    if (!(type === "xhr" || type === "fetch")) return;
    if (!looksLikeApi(url)) return;
    captures.push({
      t: new Date().toISOString(),
      method: req.method(),
      url,
      reqBody: truncate(req.postData() || null),
      reqHeaders: pickHeaders(req.headers()),
      status: null,
      resBody: null,
      resContentType: null,
    });
  });
  page.on("response", async (res) => {
    const url = res.url();
    const rec = [...captures].reverse().find((c) => c.url === url && c.status === null);
    if (!rec) return;
    rec.status = res.status();
    rec.resContentType = res.headers()["content-type"] || null;
    try {
      const ct = rec.resContentType || "";
      rec.resBody = /json|text|xml|javascript/i.test(ct)
        ? truncate(await res.text())
        : `(비텍스트 ${ct})`;
    } catch {
      rec.resBody = "(응답 읽기 실패)";
    }
  });
}

function snapshot(reason) {
  const result = {
    attachedTo: BROWSER_URL,
    baseHost: BASE_HOST,
    endedBy: reason,
    updatedAt: new Date().toISOString(),
    apiCallCount: captures.length,
    api: captures,
  };
  try { writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8"); } catch { /* 무시 */ }
}

(async () => {
  console.log(`[capital-attach] 붙는 중: ${BROWSER_URL} (host=${BASE_HOST})`);
  const browser = await puppeteer.connect({ browserURL: BROWSER_URL, defaultViewport: null });

  for (const page of await browser.pages()) attachToPage(page);
  browser.on("targetcreated", async (target) => {
    try {
      const page = await target.page();
      if (page) attachToPage(page);
    } catch { /* 무시 */ }
  });

  const timer = setInterval(() => snapshot("live"), 4000);
  browser.on("disconnected", () => { clearInterval(timer); snapshot("browser-closed"); process.exit(0); });

  console.log(`[capital-attach] 캡처 시작. 4초마다 저장: ${OUT}`);
  console.log(`[capital-attach] 그 창에서 견적을 내신 뒤 클로드에게 "확인해줘"라고 하세요. 창은 닫지 않아도 됩니다.`);
})();

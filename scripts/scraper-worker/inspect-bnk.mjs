import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

/**
 * BNK캐피탈 정찰 — 수동 조작 + 내부 API 캡처 (CDP 기반).
 *
 * BNK는 파트너 포털(web.bnkcapital.co.kr)에서 로그인하고, 견적내기를 누르면
 * 견적 엔진(aict.bnkcapital.co.kr)으로 넘어가는 다중 SPA다. 로그인·견적 흐름을
 * 코드로 미리 알 수 없으므로, 브라우저를 열어두고 **사람이 직접 로그인 → 견적내기**
 * 를 하는 동안 오가는 XHR/fetch(내부 API)를 전부 기록한다.
 *
 *   node scripts/scraper-worker/inspect-bnk.mjs
 *
 * 자격증명 불필요(사람이 직접 로그인). 끝나면 터미널에서 Enter → 결과 저장.
 * 결과: %TEMP%\bnk-recon.json  (Windows) / $TMPDIR/bnk-recon.json
 *
 * ⚠️ 브라우저는 절대 자동 종료되지 않는다. Enter 를 눌러도 저장만 하고
 *    창은 그대로 열린 채 유지되므로, 로그인 세션을 잃지 않고 몇 번이든
 *    다시 견적을 내고 Enter 로 재캡처할 수 있다. 끝내려면 창을 직접 닫거나
 *    터미널에서 Ctrl+C 를 누른다.
 *
 * ★ CDP(Network) 로 응답 본문을 loadingFinished 시점에 즉시 확보하므로,
 *   화면 전환(getEncryptTime → aict 이동)·새 탭이 있어도 본문이 유실되지 않는다.
 *   모든 탭(파트너 포털 + 견적 엔진)에 자동으로 캡처를 건다.
 */

// 기본값은 BNK 파트너(딜러) 로그인. 일반 홈이 아니라 여기서 로그인·견적을 진행한다.
const START_URL =
  process.argv[2] || "https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01";
const EXE =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = join(tmpdir(), "bnk-recon.json");

const SECURITY_HINTS = [
  "TouchEn", "nProtect", "AhnLab", "ASTx", "KeySharp", "raonsecure", "raon",
  "veraport", "INISAFE", "delfino", "IPInside", "magicline", "wizvera",
  "keypad", "keyboard", "보안키패드", "키보드보안", "captcha", "recaptcha",
];

// 자산·트래킹·폰트 등 잡음은 버린다. 내부 API 로 보이는 것만 남긴다.
const IGNORE_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|css|js|map)(\?|$)|google|gstatic|beusable|doubleclick|facebook|hotjar|analytics|sentry|newrelic/i;

function looksLikeApi(url) {
  if (IGNORE_RE.test(url)) return false;
  return (
    /\/api\/|\.do(\?|$)|\.act(\?|$)|\.json(\?|$)|\/rest\/|\/svc\/|graphql|\/gw\//i.test(url) ||
    /web\.bnkcapital\.co\.kr\/.+/i.test(url) ||
    /aict\.bnkcapital\.co\.kr\/.+/i.test(url)
  );
}

const captures = [];
const securityHits = new Set();
const aictTokens = new Set();

// 요청 본문만 안전하게 제한한다. 응답 본문은 절대 자르지 않는다
// (aict 견적 API 응답은 base64+zlib 이라 한 글자만 잘려도 디코드가 깨진다).
function truncate(s, n = 20000) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n}자)` : s;
}

function grabToken(url) {
  const m = /[?&]token=([^&]+)/.exec(url);
  if (m && /aict\.bnkcapital/i.test(url)) aictTokens.add(decodeURIComponent(m[1]));
}

function pickHeaders(h) {
  const keep = {};
  if (!h) return keep;
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (["content-type", "authorization", "x-requested-with", "referer", "cookie"].includes(lk)) {
      // 쿠키는 존재 여부만 표시(민감정보 회피).
      keep[lk] = lk === "cookie" ? "(present)" : v;
    }
  }
  return keep;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/**
 * 하나의 페이지(탭)에 CDP Network 캡처를 건다. requestId 로 요청·응답·본문을 합친다.
 */
async function attachCapture(target) {
  if (target.type() !== "page") return;
  let client;
  try {
    client = await target.createCDPSession();
  } catch {
    return;
  }
  const pending = new Map(); // requestId -> capture rec

  try {
    await client.send("Network.enable");
  } catch { /* 무시 */ }

  client.on("Network.requestWillBeSent", (e) => {
    const url = e.request?.url || "";
    grabToken(url);
    if (!looksLikeApi(url)) return;
    const rec = {
      t: new Date().toISOString(),
      method: e.request.method,
      url,
      reqBody: truncate(e.request.postData || null),
      reqHeaders: pickHeaders(e.request.headers),
      status: null,
      resBody: null,
      resContentType: null,
    };
    pending.set(e.requestId, rec);
    captures.push(rec);
  });

  client.on("Network.responseReceived", (e) => {
    const rec = pending.get(e.requestId);
    if (!rec) return;
    rec.status = e.response?.status ?? null;
    rec.resContentType = e.response?.headers?.["content-type"] || e.response?.mimeType || null;
  });

  client.on("Network.loadingFinished", async (e) => {
    const rec = pending.get(e.requestId);
    if (!rec) return;
    try {
      const { body, base64Encoded } = await client.send("Network.getResponseBody", {
        requestId: e.requestId,
      });
      const ct = rec.resContentType || "";
      if (base64Encoded && !/json|text|xml|javascript/i.test(ct)) {
        rec.resBody = `(비텍스트 ${ct})`;
      } else {
        rec.resBody = base64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
      }
    } catch {
      rec.resBody = "(응답 읽기 실패)";
    } finally {
      pending.delete(e.requestId);
    }
  });

  client.on("Network.loadingFailed", (e) => {
    const rec = pending.get(e.requestId);
    if (rec) {
      rec.status = rec.status ?? "failed";
      rec.resBody = rec.resBody ?? `(로딩 실패: ${e.errorText || ""})`;
      pending.delete(e.requestId);
    }
  });
}

(async () => {
  console.log(`[bnk-recon] 브라우저를 엽니다: ${START_URL}`);
  console.log(`[bnk-recon] 창에서 직접 로그인하고 견적을 한 번 끝까지 내보세요.`);
  console.log(`[bnk-recon] (다른 브랜드·리스/렌트로 여러 번 내면 캡처가 더 풍부해집니다.)\n`);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: EXE,
    defaultViewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });

  // 새로 열리는 탭(견적 엔진 팝업 포함)에도 자동으로 캡처를 건다.
  browser.on("targetcreated", (t) => { attachCapture(t).catch(() => {}); });
  for (const t of browser.targets()) await attachCapture(t).catch(() => {});

  const page = (await browser.pages())[0] || (await browser.newPage());

  // 보안 솔루션 흔적을 프레임 문서에서 훑는다.
  page.on("framenavigated", async () => {
    try {
      const html = await page.content();
      for (const h of SECURITY_HINTS) {
        if (html.toLowerCase().includes(h.toLowerCase())) securityHits.add(h);
      }
    } catch { /* 무시 */ }
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  // 현재 활성 페이지(탭)를 고른다. 로그인 후 새 탭/팝업으로 넘어가도 따라간다.
  async function activePage() {
    try {
      const pages = await browser.pages();
      return pages[pages.length - 1] || page;
    } catch {
      return page;
    }
  }

  async function save() {
    const p = await activePage();
    let inputs = [];
    let finalUrl = START_URL;
    try {
      finalUrl = p.url();
      inputs = await p.evaluate(() =>
        Array.from(document.querySelectorAll("input,button,a[onclick]")).slice(0, 60).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type"),
          id: el.id || null,
          name: el.getAttribute("name"),
          placeholder: el.getAttribute("placeholder"),
          text: (el.textContent || "").trim().slice(0, 24) || null,
        }))
      );
    } catch { /* 무시 */ }

    const result = {
      startUrl: START_URL,
      finalUrl,
      securityHits: [...securityHits],
      aictTokens: [...aictTokens],
      apiCallCount: captures.length,
      api: captures,
      lastScreenInputs: inputs,
    };
    writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
    console.log(`\n[bnk-recon] 저장 완료: ${OUT}`);
    console.log(`[bnk-recon] 캡처된 API 호출 ${captures.length}건, token: ${[...aictTokens].join(", ") || "없음"}`);
    console.log(`[bnk-recon] 보안 흔적: ${[...securityHits].join(", ") || "없음"}`);
    console.log(`[bnk-recon] 이 파일을 그대로 공유해 주세요.`);
  }

  // Enter 를 누를 때마다 저장만 하고 브라우저는 계속 열어 둔다.
  console.log(`[bnk-recon] 견적을 낸 뒤 Enter → 저장(브라우저는 유지됩니다).`);
  console.log(`[bnk-recon] 필요하면 다시 견적내고 또 Enter. 끝내려면 창을 닫거나 Ctrl+C.\n`);
  rl.on("line", () => {
    save().catch((e) => console.error("[bnk-recon] 저장 실패:", e));
  });

  // 브라우저가 사람 손으로 닫히면 그때 종료한다. (자동 종료 없음)
  browser.on("disconnected", () => {
    console.log("[bnk-recon] 브라우저가 닫혔습니다. 종료합니다.");
    try { rl.close(); } catch { /* 무시 */ }
    process.exit(0);
  });
})();

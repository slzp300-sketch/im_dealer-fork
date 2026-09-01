import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

/**
 * BNK캐피탈 정찰 — 수동 조작 + 내부 API 캡처.
 *
 * BNK는 일반 홈(web.bnkcapital.co.kr)에서 로그인하고 견적까지 진행하는 SPA다.
 * 로그인 폼·견적 흐름을 코드로 미리 알 수 없으므로, 브라우저를 열어두고
 * **사람이 직접 로그인 → 견적내기**를 하는 동안 오가는 XHR/fetch(내부 API)를
 * 전부 기록한다. 캡처된 API 엔드포인트·요청/응답이 어댑터 작성의 재료다.
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
  return /\/api\/|\.do(\?|$)|\.act(\?|$)|\.json(\?|$)|\/rest\/|\/svc\/|graphql|\/gw\//i.test(url) ||
    /web\.bnkcapital\.co\.kr\/.+/i.test(url);
}

const captures = [];
const securityHits = new Set();

// 응답 본문은 자르지 않는다. aict 견적 API 응답은 base64+zlib 이라 한 글자만
// 잘려도(특히 … 문자가 끼면) 디코드가 깨진다. 요청 본문만 안전하게 제한한다.
function truncate(s, n = 20000) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n}자)` : s;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

(async () => {
  console.log(`[bnk-recon] 브라우저를 엽니다: ${START_URL}`);
  console.log(`[bnk-recon] 창에서 직접 로그인하고 견적을 한 번 끝까지 내보세요.`);
  console.log(`[bnk-recon] 다 하시면 이 터미널로 돌아와 Enter 를 누르면 결과가 저장됩니다.\n`);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: EXE,
    defaultViewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());

  // 응답을 URL 로 매칭해 요청과 합친다.
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
      if (/json|text|xml|javascript/i.test(ct)) {
        // 절대 자르지 않음: base64+zlib 응답은 온전해야 디코드된다.
        rec.resBody = await res.text();
      } else {
        rec.resBody = `(비텍스트 ${ct})`;
      }
    } catch {
      rec.resBody = "(응답 읽기 실패)";
    }
  });

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
    // 로그인 폼 셀렉터 후보도 현재 화면에서 훑어 남긴다.
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
      apiCallCount: captures.length,
      api: captures,
      lastScreenInputs: inputs,
    };
    writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
    console.log(`\n[bnk-recon] 저장 완료: ${OUT}`);
    console.log(`[bnk-recon] 캡처된 API 호출 ${captures.length}건, 보안 흔적: ${[...securityHits].join(", ") || "없음"}`);
    console.log(`[bnk-recon] 이 파일을 그대로 공유해 주세요.`);
  }

  // Enter 를 누를 때마다 저장만 하고 브라우저는 계속 열어 둔다.
  // (로그인 세션을 유지한 채 몇 번이든 재캡처 가능)
  console.log(`[bnk-recon] 견적을 한 바퀴 낸 뒤 Enter → 저장(브라우저는 유지됩니다).`);
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

function pickHeaders(h) {
  const keep = {};
  for (const k of ["content-type", "authorization", "x-requested-with", "referer"]) {
    if (h[k]) keep[k] = h[k];
  }
  return keep;
}

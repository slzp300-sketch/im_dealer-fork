import puppeteer from "puppeteer";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

/**
 * 캐피탈사 공용 정찰 — 수동 조작 + 내부 API 캡처.
 *
 * 이중인증·키보드보안이 걸린 딜러 포털은 로그인·견적 흐름을 코드로 미리 알 수 없다.
 * 그래서 브라우저를 열어두고 **사람이 직접 로그인 → 견적내기**를 하는 동안 오가는
 * XHR/fetch(내부 API)를 전부 기록한다. 캡처된 엔드포인트·요청/응답이 어댑터의 재료다.
 * (BNK 정찰에 쓴 inspect-bnk.mjs 를 호스트 비의존으로 일반화한 것.)
 *
 *   node scripts/scraper-worker/inspect-capital.mjs <시작URL> [출력파일명]
 *   예) node scripts/scraper-worker/inspect-capital.mjs https://auto.nhcapital.co.kr/estimate/est/login.nh nh-recon.json
 *
 * 자격증명 불필요(사람이 직접 로그인). 견적을 한 번 끝까지 낸 뒤 터미널에서 Enter → 저장.
 * 결과: %TEMP%\<출력파일명>  (기본 capital-recon.json)
 */

const START_URL = process.argv[2];
const OUT_NAME = process.argv[3] || "capital-recon.json";
if (!START_URL) {
  console.error("사용법: node inspect-capital.mjs <시작URL> [출력파일명]");
  process.exit(1);
}
const EXE =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = join(tmpdir(), OUT_NAME);

const SECURITY_HINTS = [
  "TouchEn", "nProtect", "AhnLab", "ASTx", "KeySharp", "raonsecure", "raon",
  "transkey", "veraport", "INISAFE", "delfino", "IPInside", "magicline",
  "wizvera", "keypad", "keyboard", "보안키패드", "키보드보안", "captcha", "recaptcha",
];

// 시작 URL 의 호스트를 "우리 사이트 내부 호출" 판정 기준으로 삼는다.
let baseHost = "";
try {
  baseHost = new URL(START_URL).hostname.replace(/^www\./, "");
} catch {
  /* 무시 */
}

// 자산·트래킹·폰트 등 잡음은 버린다. 내부 API 로 보이는 것만 남긴다.
const IGNORE_RE =
  /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|css|js|map)(\?|$)|google|gstatic|beusable|doubleclick|facebook|hotjar|analytics|sentry|newrelic|kakao\.com|nprotect|raon/i;

function looksLikeApi(url) {
  if (IGNORE_RE.test(url)) return false;
  // 흔한 서버 액션 확장자/경로 or 같은 호스트의 동적 호출.
  if (/\/api\/|\.do(\?|$)|\.act(\?|$)|\.nh(\?|$)|\.kbc(\?|$)|\.json(\?|$)|\/rest\/|\/svc\/|graphql|\/gw\//i.test(url)) {
    return true;
  }
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return baseHost && h.endsWith(baseHost);
  } catch {
    return false;
  }
}

const captures = [];
const securityHits = new Set();

function truncate(s, n = 6000) {
  if (typeof s !== "string") return s;
  return s.length > n ? s.slice(0, n) + `…(+${s.length - n}자)` : s;
}

function pickHeaders(h) {
  const keep = {};
  for (const k of ["content-type", "authorization", "x-requested-with", "referer", "cookie"]) {
    if (h[k]) keep[k] = k === "cookie" ? "(생략)" : h[k];
  }
  return keep;
}

// 터미널(TTY)에서 직접 실행할 때만 Enter 종료를 받는다. 백그라운드로 띄우면
// stdin 이 없어 readline 이 즉시 닫히므로 만들지 않고, "창 닫기"로만 종료한다.
const rl = process.stdin.isTTY
  ? readline.createInterface({ input: process.stdin, output: process.stdout })
  : null;

(async () => {
  console.log(`[capital-recon] 브라우저를 엽니다: ${START_URL}`);
  console.log(`[capital-recon] 창에서 직접 로그인하고 견적을 한 번 끝까지 내보세요.`);
  console.log(`[capital-recon] 표준 조건(장기렌트·36/48/60개월 등)으로 계산하기까지 눌러 주세요.`);
  console.log(`[capital-recon] 다 하시면 이 터미널로 돌아와 Enter 를 누르면 결과가 저장됩니다.\n`);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: EXE,
    defaultViewport: null,
    args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
  });
  const page = (await browser.pages())[0] || (await browser.newPage());

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
        rec.resBody = truncate(await res.text());
      } else {
        rec.resBody = `(비텍스트 ${ct})`;
      }
    } catch {
      rec.resBody = "(응답 읽기 실패)";
    }
  });

  page.on("framenavigated", async () => {
    try {
      const html = await page.content();
      for (const h of SECURITY_HINTS) {
        if (html.toLowerCase().includes(h.toLowerCase())) securityHits.add(h);
      }
    } catch { /* 무시 */ }
  });

  await page.goto(START_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

  // 종료 경로는 두 가지: (A) 터미널에서 Enter, (B) 브라우저 창을 닫음.
  // 클로드가 백그라운드로 띄운 경우엔 터미널 stdin 을 못 쓰므로, 견적을 끝낸 뒤
  // 창을 닫기만 하면 자동 저장되도록 disconnect 도 종료 트리거로 둔다.
  let finished = false;
  async function finish(reason) {
    if (finished) return;
    finished = true;

    // 마지막 화면 폼 셀렉터 후보 — 창이 이미 닫혔으면 건너뛴다.
    let inputs = [];
    let finalUrl = START_URL;
    try {
      finalUrl = page.url();
      inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll("input,select,button,a[onclick]")).slice(0, 80).map((el) => ({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type"),
          id: el.id || null,
          name: el.getAttribute("name"),
          placeholder: el.getAttribute("placeholder"),
          onclick: (el.getAttribute("onclick") || "").slice(0, 60) || null,
          text: (el.textContent || "").trim().slice(0, 24) || null,
        }))
      );
    } catch { /* 창 닫힘 등 — 무시 */ }

    const result = {
      startUrl: START_URL,
      finalUrl,
      baseHost,
      endedBy: reason,
      securityHits: [...securityHits],
      apiCallCount: captures.length,
      api: captures,
      lastScreenInputs: inputs,
    };
    writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8");
    console.log(`\n[capital-recon] 저장 완료(${reason}): ${OUT}`);
    console.log(`[capital-recon] 캡처된 API 호출 ${captures.length}건, 보안 흔적: ${[...securityHits].join(", ") || "없음"}`);

    rl?.close();
    try { await browser.close(); } catch { /* 이미 닫힘 */ }
    process.exit(0);
  }

  // 브라우저를 닫지 않아도 최신 캡처를 확인할 수 있도록 주기적으로 저장한다.
  // (사용자는 창을 열어둔 채 견적을 여러 번 내고, 그 사이 언제든 파일을 읽을 수 있다.)
  function snapshot(reason) {
    const result = {
      startUrl: START_URL,
      finalUrl: (() => { try { return page.url(); } catch { return START_URL; } })(),
      baseHost,
      endedBy: reason,
      updatedAt: new Date().toISOString(),
      securityHits: [...securityHits],
      apiCallCount: captures.length,
      api: captures,
    };
    try { writeFileSync(OUT, JSON.stringify(result, null, 2), "utf8"); } catch { /* 무시 */ }
  }
  const saveTimer = setInterval(() => snapshot("live"), 4000);

  browser.on("disconnected", () => { clearInterval(saveTimer); void finish("browser-closed"); });
  if (rl) {
    rl.question("", () => { clearInterval(saveTimer); void finish("enter"); });
  } else {
    console.log(`[capital-recon] (백그라운드 모드) 4초마다 자동 저장합니다: ${OUT}`);
    console.log(`[capital-recon] 창을 닫지 않아도 됩니다 — 견적을 낸 뒤 클로드에게 "확인해줘"라고 하세요.`);
    console.log(`[capital-recon] 다 끝나면 창을 닫으면 최종 저장 후 종료됩니다.`);
  }
})();

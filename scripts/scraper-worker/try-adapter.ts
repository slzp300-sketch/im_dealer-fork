import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute } from "node:path";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import puppeteer, { type Browser } from "puppeteer";
import { resolveAdapter } from "./adapters/registry";
import { buildDraftFromTrimResults } from "./mapping";
import { buildBrowserLaunchArgs } from "./browser-launch";
import type { AdapterContext, CatalogScrapeOptions } from "./adapters/types";
import type { CatalogJobParams, CatalogTrimEntry, ScrapeJobParams, TrimScrapeResult } from "../../src/types/scraper";

/**
 * DB·앱 없이 실제(또는 목) 캐피탈사 사이트에 대고 어댑터만 단독 실행하는 테스트 하니스.
 *
 *   pnpm scraper:try [config경로]
 *
 * 설정: scripts/scraper-worker/try-config.json (기본) — try-config.example.json 참고.
 * 자격증명: .env 의 SCRAPER_TEST_USER / SCRAPER_TEST_PASS (우선), 없으면 config 의 username/password.
 * 브라우저: 항상 headful. .env 의 PUPPETEER_EXECUTABLE_PATH(설치된 Chrome/Edge) 사용 권장.
 *
 * 목적: "puppeteer 가 사이트에 로그인하고 견적 셀을 제대로 읽는가"(가장 불확실한 부분)를
 *       전체 파이프라인(DB/큐/Next) 없이 빠르게 검증·반복.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, ".env") });

interface TryConfig {
  loginUrl: string;
  username?: string;
  password?: string;
  config: Record<string, unknown>;
  trimIds: string[];
  weekOf: string;
  minVehiclePrice?: number;
  maxVehiclePrice?: number;
  productType?: string;
  // 이름 자동매칭 테스트용 (job.params 로 주입)
  scraperRef?: { brandCd: string; modelName: string };
  trims?: { trimId: string; name: string }[];
  // 카탈로그 전용 어댑터(BNK/WOORIFC/SHINHAN) 검증용. mode="catalog" 면 scrapeCatalog 실행.
  mode?: "trim" | "catalog";
  brands?: { brandCd: string; name: string; modelCds?: string[] }[];
}

function loadConfig(): TryConfig {
  const arg = process.argv[2];
  const path = arg
    ? isAbsolute(arg)
      ? arg
      : join(process.cwd(), arg)
    : join(__dirname, "try-config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as TryConfig;
  } catch {
    console.error(`설정 파일을 읽을 수 없습니다: ${path}\n(try-config.example.json 을 복사해 try-config.json 으로 채우세요)`);
    process.exit(1);
  }
}

// SCRAPER_TRY_AUTO=1 : 자동(비대화) 모드 — headless + 프롬프트 즉시 통과 (CI/스모크용)
const AUTO = process.env.SCRAPER_TRY_AUTO === "1";

function prompt(q: string): Promise<void> {
  if (AUTO) return Promise.resolve();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(q, () => { rl.close(); resolve(); }));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const username = process.env.SCRAPER_TEST_USER || cfg.username;
  const password = process.env.SCRAPER_TEST_PASS || cfg.password;
  if (!username || !password) {
    console.error("자격증명 없음: .env 의 SCRAPER_TEST_USER/SCRAPER_TEST_PASS 또는 try-config.json 의 username/password 를 채우세요.");
    process.exit(1);
  }

  const browser: Browser = await puppeteer.launch({
    headless: AUTO,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      ...buildBrowserLaunchArgs({
        nodeEnv: process.env.NODE_ENV,
        disableSandbox: process.env.SCRAPER_DISABLE_SANDBOX === "true",
      }),
      "--start-maximized",
    ],
    defaultViewport: null,
  });
  const page = await browser.newPage();

  const isCatalog = cfg.mode === "catalog";
  const params: ScrapeJobParams | CatalogJobParams = isCatalog
    ? {
        mode: "catalog",
        brands: cfg.brands ?? [],
        weekOf: cfg.weekOf,
        productType: cfg.productType ?? "장기렌트",
      }
    : {
        trimIds: cfg.trimIds,
        vehicleId: "test",
        lineupIds: [],
        weekOf: cfg.weekOf,
        minVehiclePrice: cfg.minVehiclePrice ?? 0,
        maxVehiclePrice: cfg.maxVehiclePrice ?? 0,
        ...(cfg.scraperRef ? { scraperRef: cfg.scraperRef } : {}),
        ...(cfg.trims ? { trims: cfg.trims } : {}),
      };

  const ctx: AdapterContext = {
    page,
    credentials: { username, password, loginUrl: cfg.loginUrl },
    config: cfg.config,
    params,
    log: (m) => console.log("  •", m),
    isCanceled: () => false,
    waitForHuman: async (p) => {
      console.log(`\n[사람 개입 필요] ${p}`);
      await prompt("브라우저에서 인증을 완료한 뒤 Enter 를 누르세요... ");
    },
  };

  const adapter = resolveAdapter(cfg.config);
  if (!adapter) {
    console.error(`config.adapter 에 맞는 어댑터가 없습니다: ${String(cfg.config?.adapter)}`);
    await browser.close().catch(() => null);
    process.exit(1);
  }

  try {
    console.log(`== 로그인 (어댑터: ${adapter.code}) ==`);
    await adapter.login(ctx);

    if (isCatalog) {
      if (!adapter.scrapeCatalog) {
        console.error(`어댑터 ${adapter.code} 는 scrapeCatalog 를 지원하지 않습니다.`);
      } else {
        console.log("== 카탈로그 수집 ==");
        const collected: CatalogTrimEntry[] = [];
        const opts: CatalogScrapeOptions = {
          brands: cfg.brands ?? [],
          isCollected: () => false,
          onTrimResult: async (e) => {
            collected.push(e);
            const cells = Object.entries(e.baseRates).map(([k, v]) => `${k}=${v}`).join(" ");
            const dp = [
              e.depositRate36_10000 ? `보증금10%(36/1만)=${e.depositRate36_10000}` : "",
              e.prepayRate36_10000 ? `선납금10%(36/1만)=${e.prepayRate36_10000}` : "",
            ].filter(Boolean).join(" ");
            console.log(`  ▷ ${e.modelName} / ${e.trimName} (${e.vehiclePrice.toLocaleString()}원) → ${cells}${e.warnings.length ? ` ⚠${e.warnings.length}` : ""}`);
            if (dp) console.log(`      ${dp}`);
          },
          onModelDone: async () => {},
          onProgress: () => {},
        };
        const res = await adapter.scrapeCatalog(ctx, opts);
        console.log(`\n== 결과: 수집 ${res.total} / 스킵 ${res.skipped} / 실패 ${res.failed} ==`);
        if (res.failures?.length) for (const f of res.failures) console.log(`  ✗ ${f.label}: ${f.reason}`);
      }
    } else {
      console.log("== 트림 수집 ==");
      const results: TrimScrapeResult[] = [];
      for (const t of cfg.trimIds) {
        const r = await adapter.scrapeTrim(ctx, t);
        console.log(
          `  - ${t}: ${r.matchConfidence}, price=${r.vehiclePrice}, baseKeys=${Object.keys(r.baseRates).length}, warn=${r.warnings.length}`
        );
        results.push(r);
      }
      const draft = buildDraftFromTrimResults(
        results,
        params as ScrapeJobParams,
        cfg.productType ?? "장기렌트",
        new Date().toISOString()
      );
      console.log("\n== 조립된 초안(draft) ==");
      console.log(JSON.stringify(draft, null, 2));
    }
    console.log("\n브라우저는 열어 둡니다. 화면 확인 후 Enter 로 종료.");
    await prompt("");
  } catch (e) {
    console.error("\n[실패]", (e as Error).message);
    console.log("브라우저는 디버깅을 위해 열어 둡니다. Enter 로 종료.");
    await prompt("");
  } finally {
    await browser.close().catch(() => null);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

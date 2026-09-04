import zlib from "node:zlib";
import type { CDPSession, Page } from "puppeteer";
import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult } from "../../../src/types/scraper";
import { assertHttpUrl } from "../safe-url";
import { rand, reqDelay as paceDelay, sleep } from "../pace";
import { pickModels } from "../model-filter";

/**
 * IM캐피탈(IM, 옛 DGB캐피탈) 장기렌트 월납입금 수집 어댑터 — **카탈로그 JSON + CDP 실클릭 구동** 방식.
 *
 * 견적 엔진은 BNK 와 동일 aict/carpan 계열(도메인 auto.dgbcap.com). 카탈로그(브랜드/모델/라인업/트림/가격)는
 * 내부 JSON API(brandList_local/modelList_search/modelData_{id})로 즉시 열거하고(응답 base64+zlib, BNK 와 동형),
 * **월납입금은 서버 계산 엔드포인트가 없다(클라이언트 JS 계산)** → 견적 화면에서 계산기를 구동해 읽는다.
 *
 * BNK 와 결정적 차이: costData/rentRemain 서버 리플레이가 불가능하므로 월렌트료는 견적 UI 를 **실제 클릭**해
 * 산출한다. puppeteer elementHandle.click() 은 가시성 대기로 hang·부분 JS 주입은 파생값 드리프트를 유발하므로
 * **CDP `Input.dispatchMouseEvent`(좌표 실클릭)** 로 네이티브 핸들러를 온전히 태운다(드리프트 0, 실측 검증).
 *
 * 로그인은 포털(www.imcap.co.kr) SMS 인증 + 견적내기 token 핸드셰이크 → 자동화 불가(requiresHuman=true).
 * 사람이 견적 화면(auto.dgbcap.com/newcar/estimate/rent)까지 진입하면 window.token 을 캡처해 API 호출에 쓴다.
 *
 * 수집 체인:
 *   modelList_search(브랜드→모델·모델명) → per model: modelData_{id}(라인업·트림·가격)
 *   → per trim: CDP 실클릭으로 브랜드→모델→라인업→트림 로드 → km 1/2/3 각각 세팅·재계산 → 3열(36/48/60) 월렌트료 읽기 = 9칸.
 * 상세: IM-NOTES.md.
 */

// aict 계산 결과 3열 = 기본 36/48/60개월. 실제 월은 컬럼에서 읽은 값을 신뢰(컬럼 구성이 달라도 견고).
// km 코드 1/2/3 = 연간주행 10000/20000/30000 → 저장 키(dist)로 매핑.
const KM_CODES: { km: string; dist: number }[] = [
  { km: "1", dist: 10000 },
  { km: "2", dist: 20000 },
  { km: "3", dist: 30000 },
];

// CDP 실클릭 구동 대기(ms). 사이트 재계산이 느려 여유를 둔다(IM-NOTES.md 실측 레시피).
const WAIT_OPEN = 800; // 드롭다운 열기 후
const WAIT_PICK_SELBAR = 1200; // 차량 selbar 선택 후
const WAIT_KM_OPEN = 700; // km 드롭다운 열기 후
const WAIT_KM_PICK = 2200; // km 선택 후(재계산)

const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 500);

// 라인업명/트림 텍스트에서 4자리 연식 추출 ("2027년형 …" → "2027").
const yearOf = (...texts: string[]): string => {
  for (const s of texts) {
    const m = String(s ?? "").match(/(20\d{2})/);
    if (m) return m[1];
  }
  return "";
};

declare global {
  interface Window {
    token?: string;
  }
}

interface SessionState {
  token: string;
}
let sess: SessionState | null = null;
class SessionExpired extends Error {}

function requireSession(): SessionState {
  if (!sess) throw new SessionExpired();
  return sess;
}
const tok = () => requireSession().token;

// modelList_search 는 전 브랜드를 한 번에 담아 반환 — 세션당 1회만 로드해 캐시(login 시 초기화).
let modelListCache: any = null;

// 현재 견적폼에 로드된 차량(브랜드/모델/라인업/트림 코드) — 같은 라인업/모델 내 트림 이동 시
// 이미 선택된 상위 kind 의 재클릭을 건너뛰는 최적화용. login/scrapeCatalog 시작 시 초기화.
type SelKind = "brand" | "model" | "lineup" | "trim";
const KIND_ORDER: SelKind[] = ["brand", "model", "lineup", "trim"];
let current: Record<SelKind, string> = { brand: "", model: "", lineup: "", trim: "" };
const resetCurrent = () => {
  current = { brand: "", model: "", lineup: "", trim: "" };
};

// IM 응답 상한 — 모델/요율 단위 소형 JSON. 압축폭탄 방지 상한.
export const IM_MAX_DECODED_RESPONSE_BYTES = 8 * 1024 * 1024;
function inflate(b64: string): string {
  return zlib
    .inflateSync(Buffer.from(b64.trim(), "base64"), { maxOutputLength: IM_MAX_DECODED_RESPONSE_BYTES })
    .toString("utf8");
}
// 응답 디코드(BNK 와 동형): base64+zlib(deflate). {rtnData} 래핑은 한 겹 더 디코드. 세션 만료 시 HTML 반환.
export function decodeImResponse(raw: string): any {
  const t = raw.trim();
  if (/^<(!doctype|html|meta)/i.test(t)) throw new SessionExpired();
  if (t.startsWith("{") || t.startsWith("[")) {
    const j = JSON.parse(t);
    if (j && j.rtnData !== undefined) return JSON.parse(inflate(j.rtnData));
    return j;
  }
  return JSON.parse(inflate(t));
}

/** auto.dgbcap.com 견적 엔진에서 GET → 디코드. 페이지가 dgbcap 오리진일 때만 유효(login 에서 보장). */
async function rawGet(ctx: AdapterContext, path: string): Promise<string> {
  return ctx.page
    .evaluate(async (u) => {
      const r = await fetch(u, {
        credentials: "include",
        headers: { "X-Requested-With": "XMLHttpRequest" },
        signal: AbortSignal.timeout(20_000),
      });
      return await r.text();
    }, path)
    .catch((e: Error) => `__FETCHERR__${e.message}`);
}

async function apiGet(ctx: AdapterContext, path: string, _retried = false): Promise<any> {
  const raw = await rawGet(ctx, path);
  if (raw.startsWith("__FETCHERR__")) {
    if (!_retried) {
      await sleep(1200);
      return apiGet(ctx, path, true);
    }
    throw new Error(raw.slice(12));
  }
  try {
    return decodeImResponse(raw);
  } catch (e) {
    if (e instanceof SessionExpired && !_retried) {
      await sleep(800);
      return apiGet(ctx, path, true);
    }
    throw e;
  }
}

async function loadModelList(ctx: AdapterContext): Promise<any> {
  if (modelListCache) return modelListCache;
  modelListCache = await apiGet(ctx, `/api/auto/modelList_search?token=${tok()}`);
  return modelListCache;
}

// ── CDP 실클릭 구동 ──────────────────────────────────────────────

/**
 * 요소 중심 좌표를 CDP 마우스 이벤트로 실제 클릭. sel 은 cellIdx 지정 시 그 .fincCell 내부에서,
 * 아니면 document 전역에서 탐색. 요소가 없거나 보이지 않으면 false(재계산 미발동).
 */
async function realClick(page: Page, client: CDPSession, sel: string, cellIdx?: number): Promise<boolean> {
  const box = await page.evaluate(
    (s, idx) => {
      const root: ParentNode | null =
        idx == null ? document : (document.querySelectorAll(".fincCell")[idx] ?? null);
      if (!root) return null;
      const el = root.querySelector(s) as HTMLElement | null;
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" }); // 브랜드/모델/라인업은 이미지 슬라이더 — 가로 스크롤 필요
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, vis: r.width > 0 && r.height > 0 };
    },
    sel,
    cellIdx ?? null
  );
  if (!box || !box.vis) return false;
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  return true;
}

/** 해당 kind 드롭다운의 옵션 리스트(.list)가 펼쳐져 있는지. */
async function isSelbarOpen(page: Page, kind: SelKind): Promise<boolean> {
  return page
    .evaluate((k) => {
      const l = document.querySelector(`.estmCell .selbar[kind='${k}'] .list`);
      return !!l && getComputedStyle(l as Element).display === "block";
    }, kind)
    .catch(() => false);
}

/**
 * 차량 selbar(kind=brand/model/lineup/trim) 에서 code 옵션을 실클릭 선택.
 * 열기 버튼은 토글이라 **이미 열려 있으면 다시 누르지 않는다**(누르면 닫혀 옵션 클릭 실패).
 * 브랜드/모델/라인업은 이미지 슬라이더 → realClick 의 inline:center 스크롤로 아이템을 뷰에 넣는다.
 */
async function pickSelbar(page: Page, client: CDPSession, kind: SelKind, code: string): Promise<boolean> {
  if (!(await isSelbarOpen(page, kind))) {
    const open = await realClick(page, client, `.estmCell .selbar[kind='${kind}'] > button`);
    if (!open) return false;
    await sleep(WAIT_OPEN);
  }
  const pick = await realClick(page, client, `.estmCell .selbar[kind='${kind}'] .list li[${kind}='${code}'] button`);
  if (!pick) return false;
  await sleep(WAIT_PICK_SELBAR);
  return true;
}

type ColRead = { month: string; km: string; remain: string; rent: number };

/** 견적폼에 로드된 각 컬럼(.fincCell)의 조건 코드 + 월렌트료 읽기. */
async function readColumns(page: Page): Promise<ColRead[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll(".fincCell")].map((c) => ({
      month: c.querySelector(".selsub[kind='monthSel']")?.getAttribute("code") ?? "",
      km: c.querySelector(".selsub[kind='kmSel']")?.getAttribute("code") ?? "",
      remain: c.querySelector(".selsub[kind='remainSel']")?.getAttribute("code") ?? "",
      rent: Number(
        (c.querySelector(".grand .total .price.num, .grand .price.num")?.textContent ?? "").replace(/[^\d]/g, "")
      ),
    }))
  );
}

/**
 * 재계산이 끝나 월렌트료가 멈출 때까지 폴링한 뒤 읽는다 — 이율 이분법·다열 재계산이
 * 비동기라, 고정 대기만으로 읽으면 중간값(오염)을 잡을 수 있다. 연속 2회 동일하면 정착으로 본다.
 */
async function readColumnsStable(page: Page, maxMs = 8000): Promise<ColRead[]> {
  let prev = await readColumns(page);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(400);
    const cur = await readColumns(page);
    if (cur.length === prev.length && cur.every((c, i) => c.rent === prev[i].rent && c.rent > 0)) return cur;
    prev = cur;
  }
  return prev;
}

interface CollectResult {
  baseRates: Record<string, number>;
  warnings: string[];
  residualByCell: Record<string, number>;
}

/**
 * 트림 1건의 9칸 월렌트료(+잔존율) 수집 — CDP 실클릭 구동.
 *  ① 브랜드→모델→라인업→트림 로드(이미 선택된 상위 kind 는 재클릭 생략).
 *  ② km 1/2/3 각각: 전 컬럼에 km 세팅(재계산) → 3열(36/48/60) 월렌트료·잔존율 읽기.
 * baseRates 키 = `${컬럼에서 읽은 month}_${dist}`. 실패/차량 미로드 시 빈 결과 + warning.
 */
async function collectTrim(
  ctx: AdapterContext,
  client: CDPSession,
  target: { brandCd: string; modelId: string; lineupId: string; trimId: string }
): Promise<CollectResult> {
  const { page } = ctx;
  const warnings: string[] = [];
  const baseRates: Record<string, number> = {};
  const residualByCell: Record<string, number> = {};

  const want: Record<SelKind, string> = {
    brand: String(target.brandCd),
    model: String(target.modelId),
    lineup: String(target.lineupId),
    trim: String(target.trimId),
  };

  // 상위 kind 가 바뀌면 하위는 전부 다시 선택해야 한다 — 첫 변경 지점 이후는 강제 재클릭.
  let mustPick = false;
  for (const kind of KIND_ORDER) {
    if (!mustPick && current[kind] === want[kind]) continue;
    mustPick = true;
    const ok = await pickSelbar(page, client, kind, want[kind]);
    if (!ok) {
      warnings.push(`차량 로드 실패(${kind}=${want[kind]})`);
      resetCurrent(); // 상태 불명 → 다음 트림은 처음부터 다시 선택
      return { baseRates, warnings, residualByCell };
    }
    current[kind] = want[kind];
  }

  // 트림 로드 검증 — selbar[kind=trim] code 가 실제 trimId 인지 확인.
  const loadedTrim = await page
    .evaluate(() => document.querySelector(".estmCell .selbar[kind='trim']")?.getAttribute("code") ?? "")
    .catch(() => "");
  if (String(loadedTrim) !== want.trim) {
    warnings.push(`트림 로드 확인 실패(표시=${String(loadedTrim).slice(0, 12)})`);
    resetCurrent();
    return { baseRates, warnings, residualByCell };
  }

  const cellCount = await page.evaluate(() => document.querySelectorAll(".fincCell").length);
  if (!(cellCount > 0)) {
    warnings.push("결과 컬럼(.fincCell) 없음");
    return { baseRates, warnings, residualByCell };
  }
  // 트림 로드 재계산이 끝날 때까지 정착 대기 — 곧바로 km 를 바꾸면 이전 재계산과 겹쳐 중간값 오염.
  await readColumnsStable(page);

  for (const { km, dist } of KM_CODES) {
    if (ctx.isCanceled()) break;
    // 전 컬럼에 동일 km 세팅(각 컬럼은 서로 다른 개월수 = 36/48/60).
    let anySet = false;
    for (let idx = 0; idx < cellCount; idx++) {
      const open = await realClick(page, client, ".selsub[kind='kmSel'] > button", idx);
      if (!open) continue;
      await sleep(WAIT_KM_OPEN);
      const pick = await realClick(page, client, `.selsub[kind='kmSel'] .list li[km='${km}'] button`, idx);
      if (!pick) continue;
      anySet = true;
      await sleep(WAIT_KM_PICK); // 재계산
    }
    if (!anySet) {
      warnings.push(`km=${km} 세팅 실패`);
      continue;
    }
    const cols = await readColumnsStable(page); // 재계산 정착 후 읽기
    for (const c of cols) {
      if (!c.month) continue;
      const key = `${c.month}_${dist}`;
      if (c.rent > 0) baseRates[key] = c.rent;
      else warnings.push(`${c.month}/${dist} 산출 0`);
      const rr = Number(c.remain);
      if (rr > 0) residualByCell[key] = rr;
    }
  }

  return { baseRates, warnings, residualByCell };
}

export const imAdapter: SiteAdapter = {
  code: "IM",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, log } = ctx;
    sess = null;
    modelListCache = null;
    resetCurrent();

    const already = /auto\.dgbcap\.com/i.test(page.url());
    if (!already) {
      log(`로그인: ${credentials.loginUrl}`);
      await page
        .goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 })
        .catch(() => null);
      await sleep(1000);
    }
    // 포털 SMS 인증 + 견적내기 token 핸드셰이크는 자동화 불가 → 사람이 견적 화면까지 진입.
    await ctx.waitForHuman(
      "IM캐피탈 포털 로그인 후 '견적내기'로 견적 화면(auto.dgbcap.com/newcar/estimate/rent)까지 진입한 뒤 [재개]를 누르세요."
    );

    // 견적 화면 준비 확인 — dgbcap 오리진 + window.token + 결과 컬럼(.fincCell) 렌더.
    const ready = await page
      .evaluate(() => ({
        host: /auto\.dgbcap\.com/i.test(location.href),
        token: String(window.token ?? ""),
        fincReady: !!document.querySelector(".fincCell"),
      }))
      .catch(() => ({ host: false, token: "", fincReady: false }));

    if (!ready.host) throw new AuthError("IM 견적 화면(auto.dgbcap.com)에 진입하지 못했습니다.");
    if (!ready.token) throw new AuthError("IM 견적 token(window.token)을 확보하지 못했습니다(견적내기 미진입 추정).");
    if (!ready.fincReady) throw new AuthError("IM 견적 결과 UI(.fincCell)가 준비되지 않았습니다.");

    sess = { token: ready.token };
    log(`세션 확보 (token=${ready.token})`);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    if (!sess) return;
    await apiGet(ctx, `/api/auto/brandList_local?token=${tok()}`).catch(() => null);
  },

  async scrapeTrim(_ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    // IM 은 카탈로그 수집(scrapeCatalog) 전용. trim_rates 지정 수집은 미지원.
    return {
      trimId: ourTrimId,
      matchConfidence: "unmatched",
      externalTrimLabel: "(IM trim_rates 미지원 — 카탈로그 수집 사용)",
      vehiclePrice: 0,
      baseRates: {},
      warnings: ["IM 은 카탈로그 수집만 지원합니다."],
    };
  },

  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { log } = ctx;
    const modelList = await loadModelList(ctx);
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      const ids = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const models = ids.map((id) => ({ modelCd: id, modelName: String(modelList?.model?.[id]?.name ?? id) }));
      log(`[차량목록] ${brand.name}(${brand.brandCd}) — ${models.length}개`);
      await opts.onBrandModels(brand, models);
      total += models.length;
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, models: models.length });
    }
    return { total, brands: brandSummaries };
  },

  async scrapeCatalog(ctx: AdapterContext, opts: CatalogScrapeOptions): Promise<CatalogScrapeResult> {
    const { log } = ctx;
    let total = 0,
      skipped = 0,
      failed = 0,
      trimsDone = 0,
      trimsTotal = 0;
    const brandSummaries: CatalogScrapeResult["brands"] = [];
    const failures: CatalogFailure[] = [];

    const modelList = await loadModelList(ctx);
    // CDP 세션 1회 확보 — 월렌트료는 실클릭 구동으로 읽는다.
    const client = await ctx.page.target().createCDPSession();
    resetCurrent();

    for (let bi = 0; bi < opts.brands.length; bi++) {
      const brand = opts.brands[bi];
      if (ctx.isCanceled()) break;

      const allModelIds = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const modelIds = pickModels(allModelIds, brand.modelCds, (id) => id);
      log(
        `[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${modelIds.length}개${
          brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allModelIds.length}개)` : ""
        }`
      );
      let brandTrims = 0;

      for (let mi = 0; mi < modelIds.length; mi++) {
        const modelId = modelIds[mi];
        if (ctx.isCanceled()) break;

        let modelData: any;
        try {
          modelData = await apiGet(ctx, `/api/auto/modelData_${modelId}?token=${tok()}`);
        } catch (e) {
          failed++;
          log(`[카탈로그] 모델 ${modelId} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          pushFailure(failures, `${brand.name} 모델 ${modelId}`, `모델 정보 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          continue;
        }
        const model = modelData?.model?.[modelId] ?? modelList?.model?.[modelId] ?? {};
        const modelName = String(model?.name ?? modelId);

        const trims = modelData?.trim ?? {};
        const lineups = modelData?.lineup ?? {};
        const quotable = Object.keys(trims).filter((tid) => Number(trims[tid]?.price) > 0);
        trimsTotal += quotable.length;
        log(`[카탈로그] ${brand.name} ${modelName} — 견적가능 트림 ${quotable.length}개`);
        opts.onProgress({
          phase: "scraping",
          brandIdx: bi + 1,
          brandCount: opts.brands.length,
          brandName: brand.name,
          modelIdx: mi + 1,
          modelCount: modelIds.length,
          modelName,
          trimsDone,
          trimsTotal,
          skipped,
          updatedAt: new Date().toISOString(),
        });

        for (const tid of quotable) {
          if (ctx.isCanceled()) break;
          trimsDone++;
          if (opts.isCollected(String(tid))) {
            skipped++;
            continue;
          }
          const td = trims[tid];
          const lineupId = String(td?.lineup ?? "");
          const lineup = lineups[lineupId];
          const lineupName = String(lineup?.name ?? "");
          const trimLabel = `${lineupName} ${td?.name ?? ""}`.trim();
          const modelYear = yearOf(String(lineup?.year ?? ""), lineupName);
          const price = Number(td?.price) || 0;
          try {
            const r = await collectTrim(ctx, client, { brandCd: brand.brandCd, modelId, lineupId, trimId: String(tid) });
            if (Object.keys(r.baseRates).length === 0) {
              failed++;
              pushFailure(failures, `${modelName} ${trimLabel}`, r.warnings[0] ?? "월렌트료 산출 0건");
            }
            const entry: CatalogTrimEntry = {
              brandCd: brand.brandCd,
              brandName: brand.name,
              modelCd: modelId,
              modelName,
              dtMdlCd: lineupId,
              dtMdlName: lineupName || undefined,
              mdelCd: String(tid),
              trimName: trimLabel,
              modelYear: modelYear || undefined,
              vehiclePrice: price,
              baseRates: r.baseRates,
              warnings: r.warnings,
            };
            await opts.onTrimResult(entry);
            total++;
            brandTrims++;
          } catch (e) {
            failed++;
            log(`[카탈로그] ${trimLabel} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
            pushFailure(failures, `${modelName} ${trimLabel}`, (e as Error).message.slice(0, 60));
          }
          opts.onProgress({
            phase: "scraping",
            brandIdx: bi + 1,
            brandCount: opts.brands.length,
            brandName: brand.name,
            modelIdx: mi + 1,
            modelCount: modelIds.length,
            modelName,
            trimsDone,
            trimsTotal,
            skipped,
            updatedAt: new Date().toISOString(),
          });
          await sleep(reqDelay(ctx.config));
        }
        await opts.onModelDone(modelId);
        // 모델 경계에서 current 를 리셋하지 않는다 — collectTrim 의 스킵 로직이 브랜드 동일 시
        // 모델부터 다시 선택하므로, 같은 브랜드 내 모델 이동에서 브랜드 재클릭을 아낀다.
        await sleep(400 + rand(0, 300));
      }
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: brandTrims });
    }

    await client.detach().catch(() => null);
    return { total, skipped, failed, brands: brandSummaries, failures };
  },
};

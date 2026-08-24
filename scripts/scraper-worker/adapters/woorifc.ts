import zlib from "node:zlib";
import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult } from "../../../src/types/scraper";
import { assertHttpUrl } from "../safe-url";
import { cellConcurrency, mapPool, rand, reqDelay as paceDelay, sleep } from "../pace";
import { pickModels } from "../model-filter";

/**
 * 우리금융캐피탈(WOORIFC) 장기렌트 월납입금 수집 어댑터 — 내부 GET JSON API(/apiw/...) 직접 호출.
 *
 * 로그인은 nProtect 키패드(자동 타이핑 불가) → 헤드풀 사람 로그인(requiresHuman=true, waitForHuman).
 * 로그인 후 발급되는 window.token 으로 /apiw 엔드포인트를 페이지 컨텍스트에서 fetch 한다.
 * 응답 인코딩: base64+zlib(deflate). {rtnData} 래핑(rentRemain/costData) 또는 raw(brandList/modelData 등).
 * 월납입금 = costData.cost.pymt_amt (서버 계산값 — 로컬 공식 불필요). 상세 WOORIFC-NOTES.md.
 *
 * 수집 체인: modelList_search + finance/woorifc_models(브랜드→모델→use=Y)
 *   → per model: modelData_{id}(라인업·트림명·가격) + finance/woorifc_M{id}(트림 MC코드)
 *   → rentRemain(잔존율) → costData(month×km, 선납/보증) → pymt_amt.
 */

const RATE_CELLS: { month: number; km: number; dist: number }[] = [
  { month: 36, km: 7, dist: 10000 }, { month: 36, km: 2, dist: 20000 }, { month: 36, km: 3, dist: 30000 },
  { month: 48, km: 7, dist: 10000 }, { month: 48, km: 2, dist: 20000 }, { month: 48, km: 3, dist: 30000 },
  { month: 60, km: 7, dist: 10000 }, { month: 60, km: 2, dist: 20000 }, { month: 60, km: 3, dist: 30000 },
];

const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 500);

// 로그인 페이지가 로드 직후 스스로 리다이렉트하면(networkidle2 뒤 JS 이동) 평가 중이던
// 프레임이 떨어져 나가 "Attempted to use detached Frame" 으로 죽는다.
// 네비게이션이 가라앉길 기다렸다가 재평가한다.
async function evalSettled<T>(page: AdapterContext["page"], fn: () => T, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return (await page.evaluate(fn)) as T;
    } catch (e) {
      const msg = String(e);
      if (i >= tries || !/detached|Execution context was destroyed|Cannot find context/i.test(msg)) throw e;
      await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => null);
      await sleep(1000);
    }
  }
}
function cfg<T>(config: Record<string, unknown> | null, key: string, fallback: T): T {
  const v = config?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

// 세션 상태 (login 에서 설정). 만료 시 HTML 응답 감지 → freshLogin.
interface SessionState {
  token: string;
  branchShop: string;
}

let sess: SessionState | null = null;

class SessionExpired extends Error {}

/**
 * 2026-08 서버 사용량 제한(WAF) 차단 응답. 임계 초과 시 200 + 70바이트
 * `<meta http-equiv="refresh" ...url=https://m.ajucapital.co.kr>` 를 돌려준다.
 * 쿨다운은 재시도 중엔 8분+ 지속(측정) — 잡 내 대기로는 못 풀므로 즉시 중단이 답.
 */
class RateLimited extends Error {
  constructor() {
    super("우리금융 사용량 제한(차단 페이지) 응답");
    this.name = "RateLimited";
  }
}

/**
 * /apiw/woori/* 계산 엔드포인트 최소 호출 간격(ms).
 * 차단 트리거는 속도가 아니라 세션당 rentRemain 4번째 호출임을 실측 확정(2026-08-20).
 * costData 는 직렬 0.5초 유휴 간격 326연속(146+60+120)에도 무사(2026-08-21 실측) — 동시 버스트(옛 fast 페이스)만 피하면 된다.
 * config.calcIntervalMs 로 조정 가능 — tarpit(응답 행 걸림/타임아웃) 재발 시 2500 으로 되돌릴 것.
 */
const CALC_INTERVAL_MS = 1000;
let lastCalcAt = 0;
let calcChain: Promise<void> = Promise.resolve();
/** 계산 호출 직렬 게이트 — 동시 셀 처리여도 시작 시각을 interval 간격으로 벌린다. */
function calcGate(ctx: AdapterContext): Promise<void> {
  const interval = cfg<number>(ctx.config, "calcIntervalMs", CALC_INTERVAL_MS);
  const p = calcChain.then(async () => {
    const wait = lastCalcAt + interval + rand(0, 800) - Date.now();
    if (wait > 0) await sleep(wait);
    lastCalcAt = Date.now();
  });
  calcChain = p.catch(() => {});
  return p;
}

// WOORIFC endpoints return small per-model/rate JSON documents. Keep a generous
// per-response ceiling so a compromised upstream cannot synchronously materialize
// an arbitrarily large deflate stream in the worker.
export const WOORIFC_MAX_DECODED_RESPONSE_BYTES = 8 * 1024 * 1024;

function inflate(b64: string): string {
  return zlib
    .inflateSync(Buffer.from(b64.trim(), "base64"), {
      maxOutputLength: WOORIFC_MAX_DECODED_RESPONSE_BYTES,
    })
    .toString("utf8");
}
export function decodeWoorifcResponse(raw: string): any {
  const t = raw.trim();
  // `<meta http-equiv=refresh ...ajucapital...` = 사용량 제한 차단 페이지 (doctype 없이 meta 단독으로 온다)
  if (t.startsWith("<") && /ajucapital|http-equiv=["']?refresh/i.test(t.slice(0, 300))) throw new RateLimited();
  if (/^<(!doctype|html)/i.test(t)) throw new SessionExpired(); // 세션 만료 시 견적 페이지 HTML 반환
  if (t.startsWith("{") || t.startsWith("[")) {
    const j = JSON.parse(t);
    if (j && j.rtnData !== undefined) return JSON.parse(inflate(j.rtnData));
    return j;
  }
  return JSON.parse(inflate(t)); // raw base64(zlib)
}

// 누적되는 큰 쿠키(httpOnly nProtect/WAF 추정)를 제거해 Cookie 헤더 폭증(→400 header too large) 해소.
// **reactive**: HTML(헤더초과) 응답 시에만 호출. preemptive 로 하면 세션 필수 쿠키를 지워 다른 캐피탈사(신한)에서 계산 실패.
// 로그인 필수 쿠키(PHPSESSID·npPfs·_ga 등)는 값이 짧아(≤150) 보존된다.
async function trimBigCookies(ctx: AdapterContext): Promise<void> {
  try {
    const cur = await ctx.page.cookies();
    const big = cur.filter((c) => c.value.length > 150);
    for (const c of big) await ctx.page.deleteCookie({ name: c.name, domain: c.domain, path: c.path });
  } catch { /* 쿠키 정리 실패는 무시 */ }
}

async function rawGet(ctx: AdapterContext, path: string): Promise<string> {
  return ctx.page.evaluate(async (u) => {
    // 응답 없는 요청에 무한정 매달리지 않는다 — 20초 넘으면 끊고 상위(apiGet)가 1회 재시도.
    // 타임아웃 없이는 서버가 응답을 안 줄 때 잡 전체가 조용히 멈춘다(하트비트만 살아있는 행).
    const r = await fetch(u, {
      credentials: "include",
      headers: { "X-Requested-With": "XMLHttpRequest" },
      signal: AbortSignal.timeout(20_000),
    });
    return await r.text();
  }, path).catch((e: Error) => `__FETCHERR__${e.message}`);
}

/** 페이지 컨텍스트에서 /apiw GET → 디코드. HTML(헤더초과) 시 큰 쿠키 정리 후 1회 재요청. */
async function apiGet(ctx: AdapterContext, path: string, _retried = false): Promise<any> {
  // 계산 엔드포인트만 사용량 제한 대상(모델 목록 등은 빠른 페이스로도 무사) — 여기만 간격 게이트.
  if (path.startsWith("/apiw/woori/")) await calcGate(ctx);
  const raw = await rawGet(ctx, path);
  if (raw.startsWith("__FETCHERR__")) {
    if (!_retried) { await sleep(1200); return apiGet(ctx, path, true); }
    throw new Error(raw.slice(12));
  }
  try {
    return decodeWoorifcResponse(raw);
  } catch (e) {
    if (e instanceof SessionExpired) {
      if (!_retried) { await trimBigCookies(ctx); await sleep(800); return apiGet(ctx, path, true); }
      const ck = await ctx.page.evaluate(() => document.cookie.length).catch(() => -1);
      ctx.log(`[HTML응답] ${path.split("?")[0]} urlLen=${path.length} cookieLen=${ck} → ${raw.trim().slice(0, 70).replace(/\s+/g, " ")}`);
    }
    throw e;
  }
}

function requireSession(): SessionState {
  if (!sess) throw new SessionExpired();
  return sess;
}

const tok = () => requireSession().token;
/** 잔존가(원) = 차량가 × 잔존율% (천원 반올림, UI 재현). */
const remainAmt = (price: number, rr: number) => Math.round((price * rr) / 100 / 1000) * 1000;

/** costData 쿼리 조립 — 캡처 기준 상수 + 가변 파라미터. */
function costUrl(ctx: AdapterContext, o: {
  fNo: number; brand: string; model: string; trim: string; price: number; modelYear: string;
  goodsKind: string; deliveryShip: string; month: number; km: number;
  prepayR: number; prepay: number; depositR: number; deposit: number; remainR: number; remain: number;
}): string {
  const p = new URLSearchParams({
    fNo: String(o.fNo), goods: "rent", token: tok(), setting: "1",
    brand: o.brand, model: o.model, trim: o.trim, reCstesmYn: "", option: "",
    colorExt: cfg(ctx.config, "colorExt", "7"), colorExtPrice: "0", colorInt: cfg(ctx.config, "colorInt", "5"), colorIntPrice: "0",
    priceBase: String(o.price), optionSum: "0", priceSum: String(o.price), modelYear: o.modelYear,
    deliveryMaker: "0", deliveryIn: "Y", discountMaker: "0", evSbsdy: "0", discountMakerR: "0",
    aprGoods: "01", takeType: "10", goodsKind: o.goodsKind, taxCtr: cfg(ctx.config, "taxCtr", "2026"),
    rateCover: "0", rateCoverR: "0", deliveryType: "20", deliveryShip: o.deliveryShip, deliverySido: "01", deliveryExtra: "0",
    dealerShop: "", branchShop: requireSession().branchShop, cmCode: "", feeAgR: "0", feeCmR: "0", feeAg: "0", feeCm: "0",
    month: String(o.month), km: String(o.km),
    prepayR: String(o.prepayR), prepay: String(o.prepay), depositR: String(o.depositR), deposit: String(o.deposit),
    remainR: String(o.remainR), remain: String(o.remain),
    requestCode: "", changeCase: "", fastshipYN: "N", contractNo: "", buyType: "1",
    insureEmp: "N", insureAge: "4", insureObj: "01", insureSelf: "300000", buySect: "", careType: "R201",
  });
  return `/apiw/woori/costData?${p.toString()}`;
}

interface CollectResult { baseRates: Record<string, number>; warnings: string[]; depositRate36_10000?: number; prepayRate36_10000?: number }

/**
 * 잔존율(rentRemain) 모델 단위 캐시 — 세션당 rentRemain 3회 제한(4번째에 차단) 우회의 핵심.
 * 가격이 다른 트림 3개의 remain 행렬·goodsKind·ship 이 완전 동일함을 실측 확인(2026-08-21)
 * → 모델당 1회만 호출하면 트림 수와 무관하게 예산 안에서 수집 가능. 로그인 시 비운다.
 */
const rrCache = new Map<string, any>();

/** 트림 1건의 9칸 월납입금 + 36/1만 보증10%·선납10% 수집. */
async function collectTrim(ctx: AdapterContext, mc: { brand: string; model: string; trim: string }, price: number, modelYear: string, evcost: string, opts?: { skipDepositPrepay?: boolean }): Promise<CollectResult> {
  const warnings: string[] = [];
  const baseRates: Record<string, number> = {};

  // 잔존율 매트릭스 (+ goodsKind/ship 획득) — 모델 단위로 동일하므로 모델당 1회만 호출
  const rrKey = `${mc.brand}:${mc.model}`;
  let rr = rrCache.get(rrKey);
  if (!rr) {
    rr = await apiGet(ctx, `/apiw/woori/rentRemain?goods=rent&token=${tok()}&brand=${mc.brand}&model=${mc.model}&trim=${mc.trim}&evcost=${evcost}&takeType=10`);
    if (rr?.rspn_cd !== "0000" || !rr.remain) { warnings.push(`잔존율 조회 실패(${rr?.rspn_cd ?? "?"})`); return { baseRates, warnings }; }
    rrCache.set(rrKey, rr);
  }
  const goodsKind = String(rr.goodsKind ?? "");
  const deliveryShip = String(rr.ship ?? "12");

  let depositRate36_10000: number | undefined;
  let prepayRate36_10000: number | undefined;

  // 셀은 서로 독립(각 셀이 fNo·잔존율까지 실어 보내는 단발 계산) → 동시 처리. 순차 복귀는 SCRAPER_PACE=safe.
  const cells = await mapPool(RATE_CELLS, cellConcurrency(ctx.config), async (c, i) => {
    const rV = Number(rr.remain?.[String(c.month)]?.[String(c.km)] ?? 0);
    const url = costUrl(ctx, { fNo: i + 1, ...mc, price, modelYear, goodsKind, deliveryShip, month: c.month, km: c.km, prepayR: 0, prepay: 0, depositR: 0, deposit: 0, remainR: rV, remain: remainAmt(price, rV) });
    const cd = await apiGet(ctx, url);
    return Number(cd?.cost?.pymt_amt ?? 0);
  });
  RATE_CELLS.forEach((c, i) => {
    if (cells[i] > 0) baseRates[`${c.month}_${c.dist}`] = cells[i];
    else warnings.push(`${c.month}/${c.dist} 산출 실패`);
  });

  // 36개월/1만km 보증금10%·선납금10%
  if (!opts?.skipDepositPrepay && baseRates["36_10000"]) {
    const rV = Number(rr.remain?.["36"]?.["7"] ?? 0);
    const tenP = Math.round((price * 0.1) / 1000) * 1000;
    try {
      const dep = await apiGet(ctx, costUrl(ctx, { fNo: 1, ...mc, price, modelYear, goodsKind, deliveryShip, month: 36, km: 7, prepayR: 0, prepay: 0, depositR: 10, deposit: tenP, remainR: rV, remain: remainAmt(price, rV) }));
      const dv = Number(dep?.cost?.pymt_amt ?? 0);
      if (dv > 0) depositRate36_10000 = dv;
      await sleep(reqDelay(ctx.config));
      const pre = await apiGet(ctx, costUrl(ctx, { fNo: 1, ...mc, price, modelYear, goodsKind, deliveryShip, month: 36, km: 7, prepayR: 10, prepay: tenP, depositR: 0, deposit: 0, remainR: rV, remain: remainAmt(price, rV) }));
      const pv = Number(pre?.cost?.pymt_amt ?? 0);
      if (pv > 0) prepayRate36_10000 = pv;
    } catch (e) {
      if (e instanceof RateLimited) throw e; // 차단은 경고로 삼키지 않고 잡 중단으로 올린다
      warnings.push(`보증/선납 수집 오류: ${(e as Error).message.slice(0, 40)}`);
    }
  }

  return { baseRates, warnings, depositRate36_10000, prepayRate36_10000 };
}

/** 년형 추출 (라인업명 "2027년형 …" → "2027"). */
function yearOf(lineupName: string): string {
  return (String(lineupName).match(/(20\d{2})\s*년형/) || [])[1] ?? "";
}

export const woorifcAdapter: SiteAdapter = {
  code: "WOORIFC",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, log } = ctx;
    log(`로그인: ${credentials.loginUrl}`);
    await page.goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1000);
    // 이미 로그인 세션이 아니면(로그인 폼 존재) 사람 로그인 대기 (nProtect 키패드 — 자동 타이핑 불가)
    const needLogin = await evalSettled(page, () => !!document.querySelector("input[name='user_id'], #user_id, input[type='password']"));
    if (needLogin) {
      await ctx.waitForHuman("우리금융 로그인을 워커 브라우저에서 완료(사번 ID + 키패드 비밀번호)한 뒤 [재개]를 누르세요.");
    }
    // 견적 페이지로 이동해 세션 토큰·지점코드 확보
    const estUrl = new URL(credentials.loginUrl);
    estUrl.pathname = cfg(ctx.config, "estimatePath", "/newcar/estimate/rent");
    estUrl.search = "";
    try {
      await page.goto(estUrl.toString(), { waitUntil: "networkidle2", timeout: 45000 });
    } catch {
      // 일시 지연으로 45초 초과 시 1회 재시도 — 여기서 실패하면 사람 로그인부터 다시 해야 해 비용이 크다.
      log("견적 페이지 이동 지연 — 재시도");
      await page.goto(estUrl.toString(), { waitUntil: "networkidle2", timeout: 45000 });
    }
    await sleep(1500);
    const info = await evalSettled(page, () => {
      const w = window as Window & {
        token?: unknown;
        estmConfig?: Array<{ branchShop?: unknown }>;
        defaultCfg?: { branchShop?: unknown };
      };
      const token = typeof w.token === "string" ? w.token : "";
      const rawBranch = w.estmConfig?.[0]?.branchShop ?? w.defaultCfg?.branchShop;
      return { token, branch: typeof rawBranch === "string" ? rawBranch : "" };
    });
    if (!info.token) throw new AuthError("우리금융 세션 토큰을 찾지 못했습니다(로그인 미완료 추정).");
    sess = { token: info.token, branchShop: info.branch || cfg(ctx.config, "branchShop", "C240") };
    rrCache.clear(); // 새 세션 — 잔존율 캐시 초기화 (주간 갱신 가능성 대비)
    log(`세션 확보 (branchShop=${sess.branchShop})`);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    if (!sess) return;
    await apiGet(ctx, `/apiw/auto/brandList_local?token=${tok()}`).catch(() => null);
  },

  async scrapeTrim(_ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    // 우리금융은 카탈로그 수집(scrapeCatalog) 중심. trim_rates 지정 수집은 미구현.
    return { trimId: ourTrimId, matchConfidence: "unmatched", externalTrimLabel: "(WOORIFC trim_rates 미지원 — 카탈로그 수집 사용)", vehiclePrice: 0, baseRates: {}, warnings: ["WOORIFC 는 카탈로그 수집만 지원합니다."] };
  },

  // 선택 브랜드의 차량(모델) 목록만 (models 잡).
  // 여기만 모델명이 모델별 응답에 들어 있어 렌트 지원(use=Y) 모델에 한해 1회씩 더 부른다 —
  // 그래도 트림 견적을 도는 카탈로그 수집보다는 훨씬 짧다.
  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { log } = ctx;
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    const modelList = await apiGet(ctx, `/apiw/auto/modelList_search?token=${tok()}`);
    const financeModels = await apiGet(ctx, `/apiw/finance/woorifc_models?token=${tok()}`);

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      const ids = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const fmBrand = financeModels?.[brand.brandCd] ?? {};
      const models: { modelCd: string; modelName: string }[] = [];

      for (const modelId of ids) {
        if (ctx.isCanceled()) break;
        if (fmBrand[modelId]?.use !== "Y") continue; // 렌트 미지원 모델 스킵
        let modelData: any;
        try {
          modelData = await apiGet(ctx, `/apiw/auto/modelData_${modelId}?token=${tok()}`);
        } catch (e) {
          log(`[차량목록] 모델 ${modelId} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          continue;
        }
        models.push({ modelCd: modelId, modelName: String(modelData?.model?.[modelId]?.name ?? modelId) });
        await sleep(reqDelay(ctx.config));
      }
      log(`[차량목록] ${brand.name}(${brand.brandCd}) — ${models.length}개`);
      await opts.onBrandModels(brand, models);
      total += models.length;
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, models: models.length });
    }
    return { total, brands: brandSummaries };
  },

  async scrapeCatalog(ctx: AdapterContext, opts: CatalogScrapeOptions): Promise<CatalogScrapeResult> {
    const { log } = ctx;
    let total = 0, skipped = 0, failed = 0, trimsDone = 0, trimsTotal = 0;
    const brandSummaries: CatalogScrapeResult["brands"] = [];
    const failures: CatalogFailure[] = [];

    // 공통 데이터 1회 로드
    const modelList = await apiGet(ctx, `/apiw/auto/modelList_search?token=${tok()}`);
    const financeModels = await apiGet(ctx, `/apiw/finance/woorifc_models?token=${tok()}`);

    for (let bi = 0; bi < opts.brands.length; bi++) {
      const brand = opts.brands[bi];
      if (ctx.isCanceled()) break;
      const allModelIds = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const modelIds = pickModels(allModelIds, brand.modelCds, (id) => id);
      const fmBrand = financeModels?.[brand.brandCd] ?? {};
      log(`[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${modelIds.length}개${brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allModelIds.length}개)` : ""}`);
      let brandTrims = 0;

      for (let mi = 0; mi < modelIds.length; mi++) {
        const modelId = modelIds[mi];
        if (ctx.isCanceled()) break;
        const fm = fmBrand[modelId];
        if (!fm || fm.use !== "Y") continue; // 렌트 미지원 모델 스킵

        let modelData: any, financeM: any;
        try {
          modelData = await apiGet(ctx, `/apiw/auto/modelData_${modelId}?token=${tok()}`);
          financeM = await apiGet(ctx, `/apiw/finance/woorifc_M${modelId}?token=${tok()}`);
        } catch (e) {
          failed++; log(`[카탈로그] 모델 ${modelId} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          pushFailure(failures, `${brand.name} 모델 ${modelId}`, `모델 정보 로드 실패: ${(e as Error).message.slice(0, 50)}`); continue;
        }
        const model = modelData?.model?.[modelId];
        const modelName = String(model?.name ?? modelId);
        const trimIds = Object.keys(modelData?.trim ?? {});
        const quotable = trimIds.filter((tid) => financeM?.trim?.[tid]?.use === "Y");
        trimsTotal += quotable.length;
        log(`[카탈로그] ${brand.name} ${modelName} — 견적가능 트림 ${quotable.length}개`);

        opts.onProgress({ phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name, modelIdx: mi + 1, modelCount: modelIds.length, modelName, trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString() });

        for (const tid of quotable) {
          if (ctx.isCanceled()) break;
          trimsDone++;
          if (opts.isCollected(tid)) { skipped++; continue; }
          const td = modelData.trim[tid];
          const lineup = modelData.lineup?.[td.lineup];
          const mc = financeM.trim[tid]; // { MAKR_CD, REP_CARTP_CD, VHCL_MDEL_CD }
          const price = Number(td.price) || 0;
          const lineupName = String(lineup?.name ?? "");
          const trimLabel = `${lineupName} ${td.name}`.trim();
          const modelYear = yearOf(lineupName);
          const evcost = `${modelId}:${td.lineup}:${tid}`;
          try {
            const r = await collectTrim(ctx, { brand: String(mc.MAKR_CD), model: String(mc.REP_CARTP_CD), trim: String(mc.VHCL_MDEL_CD) }, price, modelYear, evcost);
            if (Object.keys(r.baseRates).length === 0) {
              failed++;
              pushFailure(failures, `${modelName} ${trimLabel}`, r.warnings[0] ?? "월납입금 산출 0건");
            }
            const entry: CatalogTrimEntry = {
              brandCd: brand.brandCd, brandName: brand.name,
              modelCd: modelId, modelName,
              dtMdlCd: String(td.lineup ?? ""), dtMdlName: lineupName || undefined,
              mdelCd: tid, trimName: trimLabel,
              modelYear: modelYear || undefined,
              vehiclePrice: price,
              baseRates: r.baseRates, warnings: r.warnings,
              depositRate36_10000: r.depositRate36_10000,
              prepayRate36_10000: r.prepayRate36_10000,
            };
            await opts.onTrimResult(entry);
            total++; brandTrims++;
          } catch (e) {
            if (e instanceof RateLimited) {
              // 쿨다운이 잡 내 대기로 안 풀리는 수준(8분+) — 즉시 중단. 수집분은 증분 저장돼 있고,
              // 재실행 시 기수집 트림은 스킵되므로 이어서 수집된다.
              throw new Error(`우리금융 사용량 제한 감지 — "${trimLabel}" 에서 중단(이번 실행 수집 ${total}건은 저장됨). 10분 이상 뒤에 다시 실행하면 이어서 수집합니다.`);
            }
            failed++; log(`[카탈로그] ${trimLabel} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
            pushFailure(failures, `${modelName} ${trimLabel}`, (e as Error).message.slice(0, 60));
          }
          // 트림마다 진행률 갱신 — 모델 단위로만 올리면 트림당 수 분 걸리는 날엔
          // 화면이 몇 분째 0으로 보여 멈춘 것으로 오인된다.
          opts.onProgress({ phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name, modelIdx: mi + 1, modelCount: modelIds.length, modelName, trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString() });
          await sleep(reqDelay(ctx.config));
        }
        await opts.onModelDone(modelId);
        await sleep(400 + rand(0, 300));
      }
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: brandTrims });
    }
    return { total, skipped, failed, brands: brandSummaries, failures };
  },
};

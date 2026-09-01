import zlib from "node:zlib";
import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult } from "../../../src/types/scraper";
import { assertHttpUrl } from "../safe-url";
import { brandOrigin } from "../../../src/lib/scraper/standard-conditions";
import { cellConcurrency, mapPool, rand, reqDelay as paceDelay, sleep } from "../pace";
import { pickModels } from "../model-filter";

/**
 * BNK캐피탈(BNK) 장기렌트 월납입금 수집 어댑터 — 견적 엔진 내부 JSON API 직접 호출.
 *
 * BNK 는 파트너 포털(web.bnkcapital.co.kr, 키보드보안 TouchEn/raon)에서 사람이 로그인하고,
 * 견적내기를 누르면 견적 엔진(aict.bnkcapital.co.kr)으로 넘어가며 token 이 발급된다.
 * → 로그인은 헤드풀 사람 개입(requiresHuman=true). 사람이 **견적내기 화면까지 진입**하면
 *   그때 aict 로 흐르는 `?token=` 을 낚아채(page.on request) 이후 API 를 페이지에서 리플레이한다.
 *
 * 응답 인코딩(우리금융과 동형): base64+zlib(deflate).
 *   - {rtnData} 래핑(rentRemain/costData) → rtnData 를 한 겹 더 디코드.
 *   - raw(brandList_local, modelList_search, modelData_{id}, bnkfg_codes, rentConfig).
 * 월납입금 = costData.cost.pmtGrand (서버 계산값, 부가세 포함 — 로컬 공식 불필요). 상세 BNK-NOTES.md.
 *
 * 수집 체인:
 *   modelList_search(브랜드→모델·모델명) + bnkfg_codes(brandCM 매핑·탁송료) + rentConfig(출고지 코드)
 *   → per model: modelData_{id}(라인업·트림·가격·색상)
 *   → per trim: rentRemain(잔존율 grid + deliveryComp) → costData(month×km) → pmtGrand.
 *
 * 표준 조건(standard-conditions): 국산=특판(goodsCode LT201·takeType 특판출고 LC1110),
 *   수입=비제휴/대리점(goodsCode LT212·takeType 지점출고 LC1120). 만기선택형·개인·정비제외·표준보험·기본색상.
 *   EV 보조금은 우리 시스템 관례에 맞춰 미반영(subsidy=0) — config.applySubsidy 로 확장 여지.
 */

// 9칸(기간_연간거리). km 는 실제 연간주행(costData/rentRemain grid 키), dist 는 저장 키.
const RATE_CELLS: { month: number; km: number; dist: number }[] = [
  { month: 36, km: 10000, dist: 10000 }, { month: 36, km: 20000, dist: 20000 }, { month: 36, km: 30000, dist: 30000 },
  { month: 48, km: 10000, dist: 10000 }, { month: 48, km: 20000, dist: 20000 }, { month: 48, km: 30000, dist: 30000 },
  { month: 60, km: 10000, dist: 10000 }, { month: 60, km: 20000, dist: 20000 }, { month: 60, km: 30000, dist: 30000 },
];

const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 500);

function cfg<T>(config: Record<string, unknown> | null, key: string, fallback: T): T {
  const v = config?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

// costData/rentRemain 표준조건 고정 파라미터 (recon 캡처의 '전 브랜드 동일' 값).
const STD = {
  buyType: "A1901", // 개인
  careType: "MG15080105", // 정비제외
  endType: "C0504", // 만기선택형
  insureAge: "LC4010", insureObj: "LD2023", insureCar: "LD2033", insureSelf: "300000", insureEmp: "LD9000002", // 표준보험
  deliverySido: "LD5000001", // 서울
  deliveryType: "10", // 제휴탁송
} as const;

// 국산=특판출고/특판상품, 수입=지점출고/대리점상품 (standard-conditions).
const TAKE_TYPE = { domestic: "LC1110", imported: "LC1120" } as const;
const GOODS_CODE = { domestic: "LT201", imported: "LT212" } as const;

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

// BNK 응답 상한 — 모델/요율 단위 소형 JSON. 압축폭탄 방지 상한.
export const BNK_MAX_DECODED_RESPONSE_BYTES = 8 * 1024 * 1024;
function inflate(b64: string): string {
  return zlib
    .inflateSync(Buffer.from(b64.trim(), "base64"), { maxOutputLength: BNK_MAX_DECODED_RESPONSE_BYTES })
    .toString("utf8");
}
export function decodeBnkResponse(raw: string): any {
  const t = raw.trim();
  if (/^<(!doctype|html|meta)/i.test(t)) throw new SessionExpired(); // 세션 만료 시 HTML/리다이렉트 반환
  if (t.startsWith("{") || t.startsWith("[")) {
    const j = JSON.parse(t);
    if (j && j.rtnData !== undefined) return JSON.parse(inflate(j.rtnData)); // rentRemain/costData
    return j;
  }
  return JSON.parse(inflate(t)); // raw base64(zlib): brandList/modelData/bnkfg_codes/rentConfig
}

/** aict 견적 엔진에서 GET → 디코드. 페이지가 aict 오리진일 때만 유효(로그인에서 보장). */
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
    if (!_retried) { await sleep(1200); return apiGet(ctx, path, true); }
    throw new Error(raw.slice(12));
  }
  try {
    return decodeBnkResponse(raw);
  } catch (e) {
    if (e instanceof SessionExpired && !_retried) { await sleep(800); return apiGet(ctx, path, true); }
    throw e;
  }
}

// ── 견적 파생값 (BNK-NOTES.md 규칙) ────────────────────────────────
/** 브랜드 코드 → brandCM (bnkfg_codes.brandUse[code].map). 런타임 조회값이라 항상 최신. */
function brandCmOf(bnkfg: any, brandCode: string): string {
  return String(bnkfg?.brandUse?.[brandCode]?.map ?? "");
}
/** 라인업명/트림에서 4자리 연식 추출 ("2027년형 …" → "2027"). */
function yearOf(...texts: string[]): string {
  for (const s of texts) {
    const m = String(s ?? "").match(/(20\d{2})/);
    if (m) return m[1];
  }
  return "";
}
/** 잔존가(원) = 차량가 × 잔존율%. 캡처 실측이 원단위 정수와 일치. */
const remainAmt = (price: number, rr: number) => Math.round((price * rr) / 100);

/**
 * 제조사탁송료(deliveryMaker)와 출고지 코드(deliveryShip) 결정.
 *  - bnkfg_codes.deliveryShipCost[modelId] 있으면: 탁송료=.set, 출고지명=.map (예 "칠곡")
 *  - 없으면: 탁송료=0, 출고지명=modelData model.deliveryShip (예 "서산")
 *  - 출고지 코드는 rentConfig.deliveryShip 에서 이름 매칭(현대-칠곡→LD4000003). 수입/미매칭=LD4999999.
 */
function resolveDelivery(
  bnkfg: any, rentConfig: any, modelId: string, model: any, origin: "domestic" | "imported"
): { deliveryShip: string; deliveryMaker: number } {
  const dsc = bnkfg?.deliveryShipCost?.[modelId];
  let shipName = "";
  let deliveryMaker = 0;
  if (dsc && dsc.use === "Y") { shipName = String(dsc.map ?? ""); deliveryMaker = Number(dsc.set) || 0; }
  else { shipName = String(model?.deliveryShip ?? ""); }

  let deliveryShip = "LD4999999"; // 기타(수입/국내출고지 없음)
  if (origin === "domestic" && shipName) {
    const ds = rentConfig?.deliveryShip ?? {};
    const hit = Object.entries(ds).find(([, v]: [string, any]) => {
      const nm = String(v?.name ?? "");
      const loc = nm.split("-")[1] ?? nm; // "현대-칠곡" → "칠곡"
      return loc === shipName || nm.includes(shipName);
    });
    if (hit) deliveryShip = hit[0];
  }
  return { deliveryShip, deliveryMaker };
}

interface TrimCodes { brandCM: string; modelCM: string; lineupCM: string; trimCM: string }
interface CollectResult { baseRates: Record<string, number>; warnings: string[]; depositRate36_10000?: number; prepayRate36_10000?: number }

/** costData 쿼리 조립 — 캡처 기준 상수 + 가변 파라미터. */
function costUrl(o: {
  fNo: number; codes: TrimCodes; goodsCode: string; takeType: string; origin: "domestic" | "imported";
  price: number; colorExt: string; colorInt: string; deliveryShip: string; deliveryComp: string; deliveryMaker: number;
  month: number; km: number; remainR: number; remain: number;
  prepayR: number; prepay: number; depositR: number; deposit: number;
}): string {
  const p = new URLSearchParams({
    fNo: String(o.fNo), goods: "rent", token: tok(), goodsCode: o.goodsCode,
    brandCM: o.codes.brandCM, modelCM: o.codes.modelCM, lineupCM: o.codes.lineupCM, trimCM: o.codes.trimCM,
    optionPrice: "0", option: "",
    colorExt: o.colorExt, colorExtSelf: "", colorExtPrice: "0",
    colorInt: o.colorInt, colorIntSelf: "", colorIntPrice: "0",
    priceBase: String(o.price), priceSum: String(o.price),
    deliveryMaker: String(o.deliveryMaker), discountMaker: "0",
    subsidyNation: "0", subsidyLocal: "0", subsidy: "0", // EV 보조금 미반영(시스템 관례)
    takeType: o.takeType, buyType: STD.buyType,
    insureAge: STD.insureAge, insureObj: STD.insureObj, insureCar: STD.insureCar, insureSelf: STD.insureSelf, insureEmp: STD.insureEmp,
    deliveryType: STD.deliveryType, deliveryComp: o.deliveryComp, deliveryShip: o.deliveryShip, deliverySido: STD.deliverySido,
    feeAgR: "0", feeCmR: "0", feeAg: "0", feeCm: "0",
    endType: STD.endType, month: String(o.month), km: String(o.km),
    prepayR: String(o.prepayR), prepay: String(o.prepay),
    depositR: String(o.depositR), deposit: String(o.deposit), depositStockR: "0", depositStock: "0",
    remainR: String(o.remainR), remain: String(o.remain), careType: STD.careType,
  });
  return `/api/bnkfg/costData?${p.toString()}`;
}

/** 트림 1건의 9칸 월납입금 + 36/1만 보증10%·선납10% 수집. */
async function collectTrim(
  ctx: AdapterContext, codes: TrimCodes, goodsCode: string, takeType: string, origin: "domestic" | "imported",
  price: number, colorExt: string, colorInt: string, deliveryShip: string, deliveryMaker: number
): Promise<CollectResult> {
  const warnings: string[] = [];
  const baseRates: Record<string, number> = {};

  // 잔존율 grid + deliveryComp 획득 (트림 단위 — BNK 는 관측된 사용량 제한 없음)
  const rrUrl = `/api/bnkfg/rentRemain?goods=rent&token=${tok()}&brandCM=${codes.brandCM}&trimCM=${codes.trimCM}&deliveryShip=${deliveryShip}&takeType=${takeType}&asset=&goodsCode=${goodsCode}`;
  const rr = await apiGet(ctx, rrUrl);
  if (rr?.message?.state !== "0000" || !rr.remain) {
    warnings.push(`잔존율 조회 실패(${rr?.message?.state ?? "?"})`);
    return { baseRates, warnings };
  }
  const deliveryComp = String(rr.deliveryComp ?? "");

  let depositRate36_10000: number | undefined;
  let prepayRate36_10000: number | undefined;

  const common = { codes, goodsCode, takeType, origin, price, colorExt, colorInt, deliveryShip, deliveryComp, deliveryMaker };

  // 셀 독립 → 동시 처리. 순차 복귀는 SCRAPER_PACE=safe.
  const cells = await mapPool(RATE_CELLS, cellConcurrency(ctx.config), async (c, i) => {
    const rV = Number(rr.remain?.[String(c.month)]?.[String(c.km)] ?? 0);
    if (!(rV > 0)) return 0;
    const url = costUrl({ fNo: (i % 3) + 1, ...common, month: c.month, km: c.km, remainR: rV, remain: remainAmt(price, rV), prepayR: 0, prepay: 0, depositR: 0, deposit: 0 });
    const cd = await apiGet(ctx, url);
    return Number(cd?.cost?.pmtGrand ?? 0);
  });
  RATE_CELLS.forEach((c, i) => {
    if (cells[i] > 0) baseRates[`${c.month}_${c.dist}`] = cells[i];
    else warnings.push(`${c.month}/${c.dist} 산출 실패`);
  });

  // 36개월/1만km 보증금10%·선납금10% (검증 공식과 동일 구조)
  if (baseRates["36_10000"]) {
    const rV = Number(rr.remain?.["36"]?.["10000"] ?? 0);
    const tenP = Math.round((price * 0.1) / 1000) * 1000;
    try {
      await sleep(reqDelay(ctx.config));
      const dep = await apiGet(ctx, costUrl({ fNo: 1, ...common, month: 36, km: 10000, remainR: rV, remain: remainAmt(price, rV), prepayR: 0, prepay: 0, depositR: 10, deposit: tenP }));
      const dv = Number(dep?.cost?.pmtGrand ?? 0);
      if (dv > 0) depositRate36_10000 = dv;

      await sleep(reqDelay(ctx.config));
      const pre = await apiGet(ctx, costUrl({ fNo: 1, ...common, month: 36, km: 10000, remainR: rV, remain: remainAmt(price, rV), prepayR: 10, prepay: tenP, depositR: 0, deposit: 0 }));
      const pv = Number(pre?.cost?.pmtGrand ?? 0);
      if (pv > 0) prepayRate36_10000 = pv;
    } catch (e) {
      warnings.push(`보증/선납 수집 오류: ${(e as Error).message.slice(0, 40)}`);
    }
  }

  return { baseRates, warnings, depositRate36_10000, prepayRate36_10000 };
}

// 공통 데이터 캐시 (한 세션 = 브랜드/모델/코드/출고지 맵 1회 로드). login 시 초기화.
interface CommonData { modelList: any; bnkfg: any; rentConfig: any }
let common: CommonData | null = null;
async function loadCommon(ctx: AdapterContext): Promise<CommonData> {
  if (common) return common;
  const modelList = await apiGet(ctx, `/api/auto/modelList_search?token=${tok()}`);
  const bnkfg = await apiGet(ctx, `/api/finance/bnkfg_codes?token=${tok()}`);
  const rentConfig = await apiGet(ctx, `/api/auto/rentConfig?token=${tok()}`);
  common = { modelList, bnkfg, rentConfig };
  return common;
}

/** 렌트 미사용 모델 판정 (bnkfg_codes.modelUse.use 가 L/N 이면 제외). */
function isModelExcluded(bnkfg: any, modelId: string): boolean {
  const u = String(bnkfg?.modelUse?.[modelId]?.use ?? "");
  return u === "L" || u === "N";
}

export const bnkAdapter: SiteAdapter = {
  code: "BNK",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, log } = ctx;
    common = null;
    sess = null;

    // aict 로 흐르는 token 을 수동적으로 낚아챈다 (견적내기 진입 시 페이지가 자동 호출).
    let captured = "";
    const onReq = (req: { url(): string }) => {
      const m = /aict\.bnkcapital\.co\.kr\/.*[?&]token=([^&]+)/.exec(req.url());
      if (m) captured = decodeURIComponent(m[1]);
    };
    page.on("request", onReq);
    try {
      log(`로그인: ${credentials.loginUrl}`);
      await page.goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
      await sleep(1000);
      // 키보드보안(TouchEn/raon) — 자동 타이핑 불가. 로그인 + 견적내기 진입까지 사람이 수행.
      await ctx.waitForHuman(
        "BNK 파트너 포털에서 로그인한 뒤 '견적내기'를 눌러 견적 화면(aict)까지 진입하고 [재개]를 누르세요."
      );
      // 진입 후 token 이 안 잡혔으면, 견적 페이지에서 브랜드 목록을 눌러(자동 호출) 다시 시도하도록 안내.
      for (let i = 0; i < 20 && !captured; i++) await sleep(500);
      if (!captured) {
        await ctx.waitForHuman("견적 화면에서 브랜드를 한 번 선택(목록이 뜨도록)한 뒤 [재개]를 누르세요.");
        for (let i = 0; i < 20 && !captured; i++) await sleep(500);
      }
    } finally {
      page.off("request", onReq);
    }
    if (!captured) throw new AuthError("BNK 견적 token 을 확보하지 못했습니다(견적내기 미진입 추정).");
    if (!/aict\.bnkcapital\.co\.kr/i.test(page.url())) {
      // 이후 API 는 aict 오리진에서 fetch 해야 한다 — 견적 페이지로 이동.
      await page.goto(`https://aict.bnkcapital.co.kr/newcar/estimate/rent`, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
      await sleep(1000);
    }
    sess = { token: captured };
    log(`세션 확보 (token=${captured})`);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    if (!sess) return;
    await apiGet(ctx, `/api/auto/brandList_local?token=${tok()}`).catch(() => null);
  },

  async scrapeTrim(_ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    // BNK 는 카탈로그 수집(scrapeCatalog) 전용. trim_rates 지정 수집은 미구현.
    return { trimId: ourTrimId, matchConfidence: "unmatched", externalTrimLabel: "(BNK trim_rates 미지원 — 카탈로그 수집 사용)", vehiclePrice: 0, baseRates: {}, warnings: ["BNK 는 카탈로그 수집만 지원합니다."] };
  },

  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { log } = ctx;
    const { modelList, bnkfg } = await loadCommon(ctx);
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      const ids = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const models = ids
        .filter((id) => !isModelExcluded(bnkfg, id))
        .map((id) => ({ modelCd: id, modelName: String(modelList?.model?.[id]?.name ?? id) }));
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

    const { modelList, bnkfg, rentConfig } = await loadCommon(ctx);

    for (let bi = 0; bi < opts.brands.length; bi++) {
      const brand = opts.brands[bi];
      if (ctx.isCanceled()) break;
      const origin = brandOrigin(brand.name) ?? "domestic";
      if (brandOrigin(brand.name) === null) log(`[카탈로그] ${brand.name}: 국산/수입 미판별 — 국산(특판) 조건으로 진행(standard-conditions 확인 요)`);
      const goodsCode = cfg(ctx.config, "goodsCode", GOODS_CODE[origin]);
      const takeType = cfg(ctx.config, "takeType", TAKE_TYPE[origin]);
      const brandCM = brandCmOf(bnkfg, brand.brandCd);
      if (!brandCM) { log(`[카탈로그] ${brand.name}(${brand.brandCd}): brandCM 매핑 없음 — 스킵`); continue; }

      const allModelIds = String(modelList?.brand?.[brand.brandCd]?.modelList ?? "").split(",").filter(Boolean);
      const modelIds = pickModels(allModelIds, brand.modelCds, (id) => id).filter((id) => !isModelExcluded(bnkfg, id));
      log(`[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${modelIds.length}개${brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allModelIds.length}개)` : ""}`);
      let brandTrims = 0;

      for (let mi = 0; mi < modelIds.length; mi++) {
        const modelId = modelIds[mi];
        if (ctx.isCanceled()) break;

        let modelData: any;
        try {
          modelData = await apiGet(ctx, `/api/auto/modelData_${modelId}?token=${tok()}`);
        } catch (e) {
          failed++; log(`[카탈로그] 모델 ${modelId} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          pushFailure(failures, `${brand.name} 모델 ${modelId}`, `모델 정보 로드 실패: ${(e as Error).message.slice(0, 50)}`); continue;
        }
        const model = modelData?.model?.[modelId] ?? modelList?.model?.[modelId] ?? {};
        const modelName = String(model?.name ?? modelId);
        const { deliveryShip, deliveryMaker } = resolveDelivery(bnkfg, rentConfig, modelId, model, origin);
        // 기본 색상 = 각 색상표 첫 항목
        const colorExt = Object.keys(modelData?.colorExt ?? {})[0] ?? "";
        const colorInt = Object.keys(modelData?.colorInt ?? {})[0] ?? "";
        const modelCM = `DA${brand.brandCd}`;
        const lineupCM = `DA${modelId}`;

        const trims = modelData?.trim ?? {};
        const quotable = Object.keys(trims).filter((tid) => Number(trims[tid]?.price) > 0);
        trimsTotal += quotable.length;
        log(`[카탈로그] ${brand.name} ${modelName} — 견적가능 트림 ${quotable.length}개`);
        opts.onProgress({ phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name, modelIdx: mi + 1, modelCount: modelIds.length, modelName, trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString() });

        for (const tid of quotable) {
          if (ctx.isCanceled()) break;
          trimsDone++;
          if (opts.isCollected(tid)) { skipped++; continue; }
          const td = trims[tid];
          const lineup = modelData?.lineup?.[td.lineup];
          const lineupName = String(lineup?.name ?? "");
          const trimLabel = `${lineupName} ${td.name}`.trim();
          const modelYear = yearOf(String(lineup?.year ?? ""), lineupName);
          const price = Number(td.price) || 0;
          const codes: TrimCodes = { brandCM, modelCM, lineupCM, trimCM: `DAR${tid}${modelYear}` };
          try {
            const r = await collectTrim(ctx, codes, goodsCode, takeType, origin, price, colorExt, colorInt, deliveryShip, deliveryMaker);
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
            failed++; log(`[카탈로그] ${trimLabel} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
            pushFailure(failures, `${modelName} ${trimLabel}`, (e as Error).message.slice(0, 60));
          }
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

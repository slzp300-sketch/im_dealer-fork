import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult, TrimMatchConfidence } from "../../../src/types/scraper";
import { matchTrim, findModelIndex, type CatalogCandidate } from "../../../src/lib/scraper/trim-match";
import { brandOrigin } from "../../../src/lib/scraper/standard-conditions";
import { RATE_KEYS } from "../mapping";
import { assertHttpUrl } from "../safe-url";
import { cellConcurrency, mapPool, rand, reqDelay as paceDelay, sleep } from "../pace";
import { pickModels } from "../model-filter";

/**
 * 오릭스(ORIX) 캐피탈 렌터카 월납입금 수집 어댑터 — 내부 JSON API(/SIT0001.act) 직접 호출 방식.
 *
 * DOM 폼 자동화 대신 로그인 세션으로 ORIX 계산 API 들을 그대로 호출한다.
 * 월납입금 공식은 실차 2종(그랜저 1.6 / 쏘렌토 2.2 디젤)으로 won 단위 일치 검증 완료(ORIX-NOTES.md).
 * 반환 baseRates = 월납입금(원)/RATE_KEY. 시스템이 calcRateMatrix 로 회수율(=월납입금/차량가)을 산출한다.
 *
 * 트림 식별(둘 중 하나):
 *  1) job.params.scraperRef({brandCd,modelName}) + job.params.trims([{trimId,name}])
 *     → ORIX 모델의 트림을 긁어 우리 트림명과 토큰(배기량·인승·등급·구동·연료)으로 자동 매칭(권장).
 *  2) config.trimMap[ourTrimId] = {brandCd, dtMdlCd, mdelCd}  → 명시 매핑(폴백).
 *
 * 표준 조건 고정: 만기선택형(정비제외)/개인/특판출고/기본색상/표준보험.
 */

const SHIPMENT = "LI260001"; // 특판출고 (config.shipmentKubun 로 override 가능)
const CONST = {
  CF_PRI_KUBUN: "DA110001", DRIVE_SPEC: "RT140026", INSU_SPEC_KUBUN: "N", SPC_KUBUN: "RT130004",
  LS_GOOD_CODE: "0051", LS_GOOD_CLASS: "CF200009", MT_CODE: "014", SHIPMENT_KUBUN: SHIPMENT,
  ADDON_TST_FEE: "2600", ADDON_EN_IMP_CHARGE: "0", ADDON_PARK: "0", JAGI_CAR_RANGE: "", PAYMENT_PER: "0",
};
const MT_DIST_CODE: Record<string, string> = { "10000": "LH120001", "20000": "LH120002", "30000": "LH120003" };
const ceil10 = (n: number) => Math.ceil(n / 10) * 10;
/** 호출 간 지연(ms). 기본은 빠름 — SCRAPER_PACE=safe 면 0.7s(사람 속도)로 복귀. */
const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 700);

// ── 취득원가(lsAmount) 부대비 상수/도착지 — ORIX 견적화면 calcLsAmountCar() 재현 ──
//   lsAmount = 공급가(LOAD_AMT) + 취득세(GET_TAX) + 부대비합/1.1 − 보조금
//   부대비합 = 기본금액 + 코일매트 + 등록업체 + 외주탁송료 + 번호판배송 + 번호판선택 (+ 제조사탁송료)
const SUR = { BASE: 24000, COIL: 33000, REG_COMP: 16500 }; // 국산·특판·렌터카 고정값
const TAK_COMPANY = "5036456"; // 탁송업체((주)스타오토케어) 고정 — DELV_FEE COMPANY_KUBUN
const REG_COMPANY = "5023726"; // 등록업체((주)다코스) 고정 — WARE_SELECT CONS_CF_HCODE
const ARRIVE_AREA_NAME = "서울"; // 도착지(사용자 표준) — config.arriveAreaName 로 override 가능
// 부대비 캐시 (brand:dtMdl 단위 — 트림마다 재호출 방지). login 시 초기화.
let surchargeCache: Map<string, number> | null = null;

interface OrixTrimRef { brandCd: string; dtMdlCd: string; mdelCd: string }
function cfg<T>(config: Record<string, unknown> | null, key: string, fallback: T): T {
  const v = config?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

async function api(ctx: AdapterContext, body: Record<string, unknown>): Promise<any> {
  return ctx.page.evaluate(async (b) => {
    const res = await fetch("/SIT0001.act", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch { return { _raw: txt.slice(0, 120), _status: res.status }; }
  }, body);
}

// ── 트림명 토큰 매칭 — src/lib/scraper/trim-match 공유 모듈 사용 ─────────
/** ORIX CAR_COMBO_3 레코드 → 사이트 중립 후보로 사상. */
function toCandidates(catalog: any[]): CatalogCandidate[] {
  return catalog.map((t) => ({
    label: t.MDEL_NAME2 || t.MDEL_NAME || "",
    year: String(t.MDEL_YEAR ?? "").trim(),
  }));
}

/** 세부차종(DT_MDL_CD) 목록의 트림을 전부 긁어 견적가능(STD_RV_KUBUN 有)만 반환. */
async function fetchQuotableTrims(ctx: AdapterContext, brandCd: string, dtMdls: { DT_MDL_CD: string; DT_MDL_NM?: string }[], lsWork: string): Promise<any[]> {
  const trims: any[] = [];
  for (const s of dtMdls) {
    const list = (await api(ctx, { txGbCd: "CAR_COMBO_3", LS_WORK_KUBUN: lsWork, BRAND_CD: brandCd, DT_MDL_CD: s.DT_MDL_CD, PRE_ADC_YN: "N" })).LIST || [];
    for (const t of list) { t.__dtMdlCd = s.DT_MDL_CD; t.__dtMdlNm = s.DT_MDL_NM; t.__brandCd = brandCd; trims.push(t); } // 부대비(출고지) 조회용 코드 태깅
    await sleep(120);
  }
  // 잔가율 구분코드(STD_RV_KUBUN)가 비어있는 항목 = 잔존율 미설정 = 견적 불가(신규 연식 placeholder).
  // 같은 트림의 견적가능 항목([2026] 등)을 매처가 가리지 않도록 제외한다.
  const quotable = trims.filter((t: any) => String(t.STD_RV_KUBUN ?? "").trim() !== "");
  const dropped = trims.length - quotable.length;
  if (dropped > 0) ctx.log(`잔존율 미설정(견적불가) ${dropped}건 제외 → 견적가능 ${quotable.length}건`);
  return quotable;
}

// 모델 카탈로그 캐시(한 작업 = 한 모델, 트림마다 재조회 방지). login 시 초기화.
let catalogCache: { key: string; trims: any[] } | null = null;
async function resolveCatalog(ctx: AdapterContext, brandCd: string, modelName: string, lsWork: string): Promise<any[]> {
  const key = `${brandCd}:${modelName}`;
  if (catalogCache?.key === key) return catalogCache.trims;
  const models = (await api(ctx, { txGbCd: "CAR_COMBO_1", LS_WORK_KUBUN: lsWork, BRAND_CD: brandCd, PRE_ADC_YN: "N" })).LIST || [];
  // ORIX 모델명은 짧은 정식명(예: "G80", "그랜저")이고 우리 차량명은 마케팅 이름("디 올 뉴 G80 F/L")일 수 있다 — 공유 3단 규칙.
  const mi = findModelIndex(modelName, models.map((m: any) => String(m.MDL_NM ?? "")));
  const model = mi >= 0 ? models[mi] : undefined;
  if (!model) { catalogCache = { key, trims: [] }; return []; }
  const subs = (await api(ctx, { txGbCd: "CAR_COMBO_2", LS_WORK_KUBUN: lsWork, BRAND_CD: brandCd, MDL_CD: model.MDL_CD, PRE_ADC_YN: "N" })).LIST || [];
  const quotable = await fetchQuotableTrims(ctx, brandCd, subs, lsWork);
  catalogCache = { key, trims: quotable };
  return quotable;
}

/** 우리 trimId → ORIX 트림 레코드 해석 (이름매칭 우선, 없으면 trimMap). */
async function resolveOrixTrim(ctx: AdapterContext, ourTrimId: string, lsWork: string): Promise<{ t?: any; confidence?: TrimMatchConfidence; label?: string; warn?: string }> {
  const { config, params, log } = ctx;
  if ("mode" in params) return { warn: "카탈로그 작업에는 지정 트림 매칭을 사용할 수 없습니다." };
  const ref = params.scraperRef;
  if (ref?.brandCd && ref?.modelName) {
    const ourName = (params.trims ?? []).find((x) => x.trimId === ourTrimId)?.name ?? "";
    if (!ourName) return { warn: `트림명 없음 (${ourTrimId})` };
    const catalog = await resolveCatalog(ctx, ref.brandCd, ref.modelName, lsWork);
    if (catalog.length === 0) return { warn: `ORIX 모델 '${ref.modelName}'(브랜드 ${ref.brandCd}) 트림을 찾지 못했습니다.` };
    const m = matchTrim(ourName, toCandidates(catalog));
    if (!m) return { warn: `이름 매칭 실패: "${ourName}"` };
    const t = catalog[m.index];
    log(`매칭: "${ourName}" → "${t.MDEL_NAME2}" (${m.confidence})`);
    return { t, confidence: m.confidence, label: t.MDEL_NAME2 };
  }
  // 폴백: 명시 매핑
  const map = cfg<Record<string, OrixTrimRef>>(config, "trimMap", {})[ourTrimId];
  if (!map) return { warn: `매핑 없음 (${ourTrimId}) — 차량에 ORIX 연결 또는 trimMap 설정 필요` };
  const list = (await api(ctx, { txGbCd: "CAR_COMBO_3", LS_WORK_KUBUN: lsWork, BRAND_CD: map.brandCd, DT_MDL_CD: map.dtMdlCd, PRE_ADC_YN: "N" })).LIST || [];
  const t = list.find((x: any) => x.MDEL_CD === map.mdelCd);
  if (t) { t.__dtMdlCd = map.dtMdlCd; t.__brandCd = map.brandCd; }
  return t ? { t, confidence: "exact", label: t.MDEL_NAME2 } : { warn: `CAR_COMBO_3 에서 MDEL_CD=${map.mdelCd} 없음` };
}

export const orixAdapter: SiteAdapter = {
  code: "ORIX",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, config, log } = ctx;
    catalogCache = null;
    surchargeCache = null;
    const menu = cfg(config, "productMenu", "/sit/sit0001.frm");
    log(`로그인: ${credentials.loginUrl}`);
    await page.goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(800);
    // 이미 유효 세션이면 login.frm 이 메인으로 리다이렉트 → 로그인 폼이 없음(재로그인 안전 통과)
    const hasForm = await page.$("#usrId");
    if (hasForm) {
      await page.type("#usrId", credentials.username, { delay: 40 });
      await page.type("#usrPw", credentials.password, { delay: 40 });
      await Promise.all([page.click("#login"), page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => null)]);
      await sleep(1500);
      if (/login\.frm/i.test(page.url())) {
        const msg = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "");
        if (/인증|otp|sms|휴대폰/i.test(msg)) await ctx.waitForHuman("오릭스 추가 인증을 워커 PC 브라우저에서 완료한 뒤 [재개]를 누르세요.");
        else throw new AuthError(`오릭스 로그인 실패(자격증명 오류 추정). 화면: ${msg.slice(0, 80)}`);
      }
    } else {
      log("이미 로그인 상태 — 로그인 폼 생략");
    }
    await page.evaluate((m: string) => {
      const w = window as Window & { goPageMenu?: (p: string) => void };
      if (typeof w.goPageMenu === "function") w.goPageMenu(m);
    }, menu);
    await sleep(2500);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await api(ctx, { txGbCd: "CONS_COMBO1" }).catch(() => null);
  },

  async scrapeTrim(ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    const { config, log } = ctx;
    const lsWork = cfg(config, "lsWorkKubun", "CF100006");
    const warnings: string[] = [];

    const resolved = await resolveOrixTrim(ctx, ourTrimId, lsWork);
    if (!resolved.t) {
      return { trimId: ourTrimId, matchConfidence: "unmatched", externalTrimLabel: resolved.warn ?? "(매칭 실패)", vehiclePrice: 0, baseRates: {}, warnings: [resolved.warn ?? "트림 해석 실패"] };
    }
    const t = resolved.t;
    const carAmt = Number(t.MDEL_PRICE); // 기본색상(0원) 기준
    log(`수집: ${t.MDEL_NAME2} (${t.MDEL_CD}) ${carAmt.toLocaleString()}원`);

    const first = await collectBaseRates(ctx, t, lsWork);
    let baseRates = first.baseRates;
    let depositRate36_10000 = first.depositRate36_10000;
    let prepayRate36_10000 = first.prepayRate36_10000;
    warnings.push(...first.warnings);
    // 매칭됐는데 0건이면 세션 만료 가능성(드묾). 안전망: 쿠키 초기화 후 새 세션 재로그인 + 차량 재선택 후 1회 재시도.
    // 실패해도 예외 없이 부분 저장. (대량 수집 0건의 실제 원인이던 '잔존율 미설정 트림'은 resolveCatalog 에서 이미 제외됨)
    if (Object.keys(baseRates).length === 0 && carAmt > 0) {
      log("월납입금 0건 — 세션 만료 가능성, 새 세션으로 재로그인 후 재시도");
      try {
        await freshLogin(ctx);
        const re = await resolveOrixTrim(ctx, ourTrimId, lsWork); // 새 세션에서 차량 콤보 재선택 (이게 빠지면 계산이 0 반환)
        const retry = re.t ? await collectBaseRates(ctx, re.t, lsWork) : { baseRates: {} as Record<string, number>, warnings: [re.warn ?? "재해석 실패"] };
        if (Object.keys(retry.baseRates).length > 0) {
          baseRates = retry.baseRates;
          depositRate36_10000 = retry.depositRate36_10000;
          prepayRate36_10000 = retry.prepayRate36_10000;
        } else warnings.push(...retry.warnings);
      } catch (e) {
        warnings.push(`재시도 실패: ${(e as Error).message.slice(0, 60)}`);
      }
    }

    return { trimId: ourTrimId, matchConfidence: resolved.confidence ?? "exact", externalTrimLabel: resolved.label ?? t.MDEL_NAME2, vehiclePrice: carAmt, baseRates, depositRate36_10000, prepayRate36_10000, warnings };
  },

  // 선택 브랜드의 차량(모델) 목록만 (models 잡). 브랜드당 API 1회 — 트림 견적은 긁지 않는다.
  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { config, log } = ctx;
    const lsWork = cfg(config, "lsWorkKubun", "CF100006");
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      const list = (await api(ctx, { txGbCd: "CAR_COMBO_1", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, PRE_ADC_YN: "N" })).LIST || [];
      const models = list
        .map((m: any) => ({ modelCd: String(m.MDL_CD ?? ""), modelName: String(m.MDL_NM ?? "") }))
        .filter((m: { modelCd: string }) => m.modelCd);
      log(`[차량목록] ${brand.name}(${brand.brandCd}) — ${models.length}개`);
      await opts.onBrandModels(brand, models);
      total += models.length;
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, models: models.length });
    }
    return { total, brands: brandSummaries };
  },

  // 선택 브랜드의 ORIX 등록 전 모델·전 트림 수집 (catalog 잡). 우리 트림 매칭 없이 원본 그대로.
  async scrapeCatalog(ctx: AdapterContext, opts: CatalogScrapeOptions): Promise<CatalogScrapeResult> {
    const { config, log } = ctx;
    const lsWork = cfg(config, "lsWorkKubun", "CF100006");
    let total = 0, skipped = 0, failed = 0, trimsDone = 0, trimsTotal = 0;
    const brandSummaries: CatalogScrapeResult["brands"] = [];
    const failures: CatalogFailure[] = [];

    for (let bi = 0; bi < opts.brands.length; bi++) {
      const brand = opts.brands[bi];
      if (ctx.isCanceled()) break;
      // 표준조건 가드: 특판출고(SHIPMENT)는 국산 채널 전제 — 수입/미등록 브랜드가 추가되면 조건 재확인 필요 (standard-conditions.ts)
      if (brandOrigin(brand.name) !== "domestic") {
        log(`[카탈로그] ${brand.name}: 국산(특판) 채널로 확인되지 않은 브랜드 — 특판출고 조건이 부적합할 수 있음 (표준조건: 수입=비제휴)`);
      }
      const allModels = (await api(ctx, { txGbCd: "CAR_COMBO_1", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, PRE_ADC_YN: "N" })).LIST || [];
      const models = pickModels(allModels, brand.modelCds, (m: any) => String(m.MDL_CD));
      log(`[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${models.length}개${brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allModels.length}개)` : ""}`);
      let brandTrims = 0;

      for (let mi = 0; mi < models.length; mi++) {
        const model = models[mi];
        if (ctx.isCanceled()) break;
        opts.onProgress({
          phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name,
          modelIdx: mi + 1, modelCount: models.length, modelName: String(model.MDL_NM ?? ""),
          trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString(),
        });
        const subs = (await api(ctx, { txGbCd: "CAR_COMBO_2", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, MDL_CD: model.MDL_CD, PRE_ADC_YN: "N" })).LIST || [];
        const quotable = await fetchQuotableTrims(ctx, brand.brandCd, subs, lsWork);
        trimsTotal += quotable.length;
        log(`[카탈로그] ${brand.name} ${model.MDL_NM} — 견적가능 트림 ${quotable.length}개`);

        for (const t of quotable) {
          if (ctx.isCanceled()) break;
          trimsDone++;
          if (opts.isCollected(t.MDEL_CD)) { skipped++; continue; } // 이번주 기수집 — 재개 시 스킵
          try {
            // 카탈로그도 36개월/1만km 보증금10%·선납금10% 는 수집(트림당 2콜 추가). 나머지 셀은 baseRates만.
            let r = await collectBaseRates(ctx, t, lsWork);
            if (Object.keys(r.baseRates).length === 0 && Number(t.MDEL_PRICE) > 0) {
              // 세션 만료 추정 — 새 세션 로그인 + 현재 위치 콤보 재선점화 후 1회 재시도
              log(`[카탈로그] ${t.MDEL_NAME2}: 월납입금 0건 — 재로그인 후 재시도`);
              await freshLogin(ctx);
              await api(ctx, { txGbCd: "CAR_COMBO_1", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, PRE_ADC_YN: "N" });
              await api(ctx, { txGbCd: "CAR_COMBO_2", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, MDL_CD: model.MDL_CD, PRE_ADC_YN: "N" });
              await api(ctx, { txGbCd: "CAR_COMBO_3", LS_WORK_KUBUN: lsWork, BRAND_CD: brand.brandCd, DT_MDL_CD: t.__dtMdlCd, PRE_ADC_YN: "N" });
              r = await collectBaseRates(ctx, t, lsWork);
            }
            if (Object.keys(r.baseRates).length === 0) {
              failed++;
              pushFailure(failures, `${String(model.MDL_NM ?? "")} ${String(t.MDEL_NAME2 || t.MDEL_NAME || t.MDEL_CD)}`, r.warnings[0] ?? "월납입금 산출 0건");
            }
            const entry: CatalogTrimEntry = {
              brandCd: brand.brandCd, brandName: brand.name,
              modelCd: String(model.MDL_CD), modelName: String(model.MDL_NM ?? ""),
              dtMdlCd: String(t.__dtMdlCd ?? ""), dtMdlName: t.__dtMdlNm ? String(t.__dtMdlNm) : undefined,
              mdelCd: String(t.MDEL_CD), trimName: String(t.MDEL_NAME2 || t.MDEL_NAME || ""),
              modelYear: String(t.MDEL_YEAR ?? "").trim() || undefined,
              vehiclePrice: Number(t.MDEL_PRICE) || 0,
              baseRates: r.baseRates, warnings: r.warnings,
              depositRate36_10000: r.depositRate36_10000,
              prepayRate36_10000: r.prepayRate36_10000,
            };
            await opts.onTrimResult(entry);
            total++;
            brandTrims++;
          } catch (e) {
            failed++;
            log(`[카탈로그] ${t.MDEL_NAME2 ?? t.MDEL_CD} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
            pushFailure(failures, `${String(model.MDL_NM ?? "")} ${String(t.MDEL_NAME2 ?? t.MDEL_CD)}`, (e as Error).message.slice(0, 60));
          }
          await sleep(reqDelay(config));
        }
        await opts.onModelDone(String(model.MDL_CD)); // 모델 경계 — 워커가 flush
        await sleep(500 + rand(0, 350)); // 모델 간 지연 (트림 간보다 길게)
      }
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: brandTrims });
    }
    return { total, skipped, failed, brands: brandSummaries, failures };
  },
};

/** 쿠키 삭제 후 새 세션 로그인 (세션 만료 안전망 — scrapeTrim/scrapeCatalog 공용). */
async function freshLogin(ctx: AdapterContext): Promise<void> {
  const cookies = await ctx.page.cookies();
  if (cookies.length) await ctx.page.deleteCookie(...cookies);
  await orixAdapter.login(ctx); // 쿠키가 비었으므로 실제 새 세션 로그인 (catalogCache 도 리셋됨)
}

/**
 * 부대비 총액(취득원가 가산분) 계산. ORIX calcLsAmountCar() 재현.
 *   PRDC_DELI(출발지) + CONS_COMBO2(도착지 서울) + WARE_SELECT(배송·번호판) + DELV_FEE(탁송료)
 * brand:dtMdl 단위 캐시 — 트림마다 재호출하지 않음(요청량·탐지 footprint 절감).
 */
async function surchargeTotal(ctx: AdapterContext, brandCd: string, dtMdlCd: string, lsWork: string): Promise<number> {
  surchargeCache ??= new Map();
  const key = `${brandCd}:${dtMdlCd}`;
  const hit = surchargeCache.get(key);
  if (hit !== undefined) return hit;
  const arriveName = cfg(ctx.config, "arriveAreaName", ARRIVE_AREA_NAME);
  try {
    const prdc = (await api(ctx, { txGbCd: "PRDC_DELI", DT_MDL_CD: dtMdlCd })).LIST || [];
    let depart = prdc.find((x: any) => x.DELIVERY_START)?.DELIVERY_START; // 제조사 출고지(공장)
    const area = (await api(ctx, { txGbCd: "CONS_COMBO2", MAKER_CF_HCODE: brandCd, LS_WORK_KUBUN: lsWork })).LIST || [];
    const arrive = area.find((x: any) => x.CONS_DSCD === "CONS4" && String(x.CODE_HNAME ?? "").includes(arriveName))?.CODE_FIRST; // 도착지(서울)
    if (!depart) depart = area.find((x: any) => x.CONS_DSCD === "CONS3")?.CODE_FIRST; // PRDC_DELI 비면 제조사 1차 출고지로 폴백
    const ware = (await api(ctx, { txGbCd: "WARE_SELECT", CONS_CF_HCODE: REG_COMPANY, MAKER_CF_HCODE: brandCd })).LIST || [];
    const regDeliv = Number((ware.find((x: any) => x.CODE_FIRST === "CA980001") || {}).WARE_AMT || 0); // 탁송사배송
    const licns = Number((ware.find((x: any) => x.CODE_FIRST === "CA990002") || {}).WARE_AMT || 0); // 번호판선택(전기)
    let takAmt = 0;
    if (depart && arrive) {
      const dfee = (await api(ctx, { txGbCd: "DELV_FEE", COMPANY_KUBUN: TAK_COMPANY, DEPART_AREA_CD: depart, ARRIVE_AREA_CD: arrive })).LIST || [];
      takAmt = Number((dfee[0] || {}).DELIVERY_FEE || 0);
    } else {
      ctx.log(`부대비: 출발지(${depart})/도착지(${arrive}) 미확인 — 탁송료 0 (값 부정확 가능)`);
    }
    const regTot = Math.trunc((SUR.BASE + SUR.COIL + SUR.REG_COMP + takAmt + regDeliv + licns) / 1.1);
    surchargeCache.set(key, regTot);
    return regTot;
  } catch (e) {
    ctx.log(`부대비 계산 실패: ${(e as Error).message.slice(0, 50)} — 0 처리(값 부정확 가능)`);
    return 0;
  }
}

interface CollectResult { baseRates: Record<string, number>; warnings: string[]; depositRate36_10000?: number; prepayRate36_10000?: number }

/** 트림 1개의 기간×거리 월납입금 수집 (세션 살아있을 때 정상값, 만료 시 빈 결과).
 *  opts.skipDepositPrepay: catalog 전량 수집 시 보증금/선납 2콜 생략 (요청량 절감). */
async function collectBaseRates(ctx: AdapterContext, t: any, lsWork: string, opts?: { skipDepositPrepay?: boolean }): Promise<CollectResult> {
  const { config } = ctx;
  const warnings: string[] = [];
  const carAmt = Number(t.MDEL_PRICE);
  const shipment = cfg(config, "shipmentKubun", SHIPMENT); // 기본 특판출고(LI260001)
  // 특판출고 할인: 트림의 특판할인율(DIS_AMT_PER %) 만큼 공급가·개소세 산정에서 차감해야 함.
  // (대리점출고는 보통 0 → 영향 없음). 누락 시 공급가가 높아져 월납입금이 과대 산출됨.
  const disPer = Number(t.DIS_AMT_PER ?? 0) || 0;
  const speDisAmt = Math.round(carAmt * disPer / 100);

  const sup = await api(ctx, { txGbCd: "GET_SUPPLAYAMT", LS_GOOD_KUBUN: lsWork, MDEL_CD: t.MDEL_CD, SHIPMENT_KUBUN: shipment, CAR_AMT: String(carAmt), OPTION_AMT: "0", CAR_COR_AMT: "0", MAKER_TAK_AMT: "0", DIS_AMT_PER: String(disPer), DIS_AMT: String(speDisAmt), KIRATE: t.KIRATE_2015, AMT_KUBUN: "1" });
  if (!(Number(sup.LOAD_AMT) > 0)) return { baseRates: {}, warnings: ["공급가 조회 실패 (세션 만료 추정)"] }; // 세션 끊김 빠른 감지
  // 공급가(LOAD_AMT) = (차량가 − 특판할인) / KIRATE(트림별 기준이율). GET_SUPPLAYAMT(AMT_KUBUN=1)은 ÷1.1 고정이라
  // KIRATE≠1.1 차종(예: LPG)에서 공급가·취득세·월납입금이 과대 산출됨 → ORIX 견적화면과 동일하게 KIRATE 로 나눈다.
  const KIRATE = Number(t.KIRATE_2015) || 1.1;
  const LOAD_AMT = ceil10((carAmt - speDisAmt) / KIRATE);

  const SPECIFIC_TAX = Number((await api(ctx, { txGbCd: "SPECIFIC_TAX_CAL", SHIPMENT_KUBUN: shipment, MDEL_CD: t.MDEL_CD, LOAD_AMT: String(carAmt), DIS_PER: String(disPer), DIS_AMT: String(speDisAmt), LS_WORK_KUBUN: lsWork, LS_GOOD_CODE: "0051" })).SPECIFIC_TAX);
  const GET_TAX = Number((await api(ctx, { txGbCd: "REG_TAX_CAL", LOAD_AMT: String(LOAD_AMT), MDEL_CD: t.MDEL_CD, SHIPMENT_KUBUN: shipment, MAKER_NO: "", LS_GOOD_CLASS: "CF200009", MAKER_TAK_AMT: "0" })).GET_TAX);
  // 취득원가 = 공급가 + 취득세 + 부대비 − 보조금. (보조금: HEV/가솔린 0, EV 별도 — 아래 경고)
  const brandCd = t.__brandCd ?? ("mode" in ctx.params ? undefined : ctx.params.scraperRef?.brandCd) ?? "";
  const regTot = brandCd && t.__dtMdlCd ? await surchargeTotal(ctx, brandCd, t.__dtMdlCd, lsWork) : 0;
  // EV 전기차보조금: 트림 SUBSIDY_USE_YN=Y 면 SUBSIDY_LIST 의 옵션(휠)별 보조금을 취득원가에서 차감.
  // 옵션이 여러 종이면 기본(첫 옵션). config.subsidyOption(예 "18인치")로 지정 가능.
  let subsidyAmt = 0;
  if (String(t.SUBSIDY_USE_YN) === "Y") {
    const subList = (await api(ctx, { txGbCd: "SUBSIDY_LIST", MDEL_CD: t.MDEL_CD })).LIST || [];
    const want = cfg(config, "subsidyOption", "");
    const opt = (want && subList.find((x: any) => String(x.OPTION_NAME ?? "").includes(want))) || subList[0];
    subsidyAmt = Number(opt?.SUBSIDY_AMT || 0);
    if (subsidyAmt > 0) ctx.log(`EV 보조금 ${subsidyAmt.toLocaleString()}원(${opt?.OPTION_NAME}) 차감 — 옵션 ${subList.length}종 중 기본`);
    else warnings.push("EV 보조금 조회 실패 — 값 검토 필요");
  }
  const lsAmount = LOAD_AMT + GET_TAX + regTot - subsidyAmt;
  const disp = Number(t.DISPLACEMENT);
  // 자동차세 가산분: 내연기관은 영업용 자동차세율(배기량×18~19/12). EV(배기량0)는 영업용 정액 자동차세(연/60).
  const ADDON_CAR_TAX = disp > 0 ? ceil10((disp * (disp <= 1600 ? 18 : 19)) / 12) : ceil10(Number(t.CAR_TAX_YEAR ?? 0) / 60);

  const rvRes = await api(ctx, { txGbCd: "SEL_RV_LIST", LS_WORK_KUBUN: lsWork, SHIPMENT_KUBUN: shipment, IMPDOM_KUBUN: t.IMPDOM_KUBUN, MDEL_CD: t.MDEL_CD, RV_RANK: t.RV_RANK, OPER_RV_KUBUN: t.OPER_RV_KUBUN, ADJ_RV_KUBUN: t.ADJ_RV_KUBUN, STD_RV_KUBUN: t.STD_RV_KUBUN });
  const rvBy: Record<string, number> = {};
  for (const r of rvRes.LIST || []) rvBy[`${r.KIKAN}_${r.MT_DIST}`] = Number(r.RV_RATE);

  const baseRates: Record<string, number> = {};
  let depositRate36_10000: number | undefined;
  let prepayRate36_10000: number | undefined;
  // 셀은 서로 독립(CAL_LSRYOW 는 파라미터만으로 계산) → 동시 처리. 순차 복귀는 SCRAPER_PACE=safe.
  type Cell = { key: string | null; ls: number; deposit?: number; prepay?: number; warnings: string[] };
  const cellResults = await mapPool(RATE_KEYS, cellConcurrency(config), async (keyk): Promise<Cell> => {
    const cellWarnings: string[] = [];
    const [months, dist] = keyk.split("_");
    const rate = rvBy[`${months}_${dist}`];
    if (!(rate > 0)) { cellWarnings.push(`${keyk}: 잔존율 없음`); return { key: null, ls: 0, warnings: cellWarnings }; } // 빈 잔존율(Number("")=0)도 제외
    const notRvAmt = Math.ceil((carAmt / 1.1) * (rate / 100) / 1000) * 1000;
    const calBody: Record<string, unknown> = {
      txGbCd: "CAL_LSRYOW", CAR_INSU_KUBUN: t.CAR_INSU_KUBUN, CAR_MT_KUBUN: t.CAR_MT_KUBUN, RT_MT_RATE: t.RT_MT_RATE, RT_SELF_CAR_RATE: t.RT_SELF_CAR_RATE, OPER_RV_KUBUN: t.OPER_RV_KUBUN, IMPDOM_KUBUN: t.IMPDOM_KUBUN, MDEL_CD: t.MDEL_CD, LS_WORK_KUBUN: lsWork, ...CONST, SHIPMENT_KUBUN: shipment,
      LEASE_KIKAN: months, MT_DIST: MT_DIST_CODE[dist], LOAD_AMT: String(LOAD_AMT), lsAmount: String(lsAmount), notRvAmt: String(notRvAmt), NOT_WRNT_RV: String(rate), ADDON_SPEND_W: String(ceil10(SPECIFIC_TAX / Number(months))), ADDON_CAR_TAX: String(ADDON_CAR_TAX),
    };
    if (ctx.isCanceled()) return { key: null, ls: 0, warnings: cellWarnings };
    const res = await api(ctx, calBody);
    const ls = Number(res.LSRYO);
    if (!(ls > 0)) cellWarnings.push(`${keyk}: 월납입금 산출 실패 (${res.APP_HEADER?.respMsg ?? "?"})`);

    // 36개월·1만km 셀에 한해 보증금10%·선납금10% 견적도 수집 (캡처로 검증된 공식)
    //  - 보증금10%: PAYMENT_PER=10 + lsAmount·notRvAmt 에서 보증금(차량가×10%) 차감 → CAL 결과 그대로
    //  - 선납금10%: PAYMENT_PER=10(금액 유지) → CAL gross 에서 회차균등배분(선납금/기간) 차감
    let deposit: number | undefined;
    let prepay: number | undefined;
    if (keyk === "36_10000" && ls > 0 && !opts?.skipDepositPrepay) {
      const dep = Math.round(carAmt * 0.1); // 보증금/선납금 = 차량가 10%
      try {
        await sleep(reqDelay(config));
        const depRes = await api(ctx, { ...calBody, PAYMENT_PER: "10", lsAmount: String(lsAmount - dep), notRvAmt: String(notRvAmt - dep) });
        const depLs = Number(depRes.LSRYO);
        if (depLs > 0) deposit = depLs;
        else cellWarnings.push(`보증10%: 산출 실패 (${depRes.APP_HEADER?.respMsg ?? "?"})`);

        await sleep(reqDelay(config));
        const preRes = await api(ctx, { ...calBody, PAYMENT_PER: "10" }); // 금액 유지(선납은 회차균등배분으로 차감)
        const preGross = Number(preRes.LSRYO);
        if (preGross > 0) prepay = preGross - ceil10(dep / Number(months));
        else cellWarnings.push(`선납10%: 산출 실패 (${preRes.APP_HEADER?.respMsg ?? "?"})`);
      } catch (e) {
        cellWarnings.push(`선납/보증 수집 오류: ${(e as Error).message.slice(0, 40)}`);
      }
    }
    return { key: keyk, ls, deposit, prepay, warnings: cellWarnings };
  });

  for (const r of cellResults) {
    warnings.push(...r.warnings);
    if (!r.key) continue;
    if (r.ls > 0) baseRates[r.key] = r.ls;
    if (r.deposit !== undefined) depositRate36_10000 = r.deposit;
    if (r.prepay !== undefined) prepayRate36_10000 = r.prepay;
  }
  return { baseRates, warnings, depositRate36_10000, prepayRate36_10000 };
}

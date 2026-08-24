import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult } from "../../../src/types/scraper";
import { assertHttpUrl } from "../safe-url";
import { pickModels } from "../model-filter";
import { cellConcurrency, mapPool, rand, reqDelay as paceDelay, sleep } from "../pace";

/**
 * 신한카드(SHINHAN) 장기렌트 월납입금 수집 어댑터 — 내부 POST `.ajax` JSON API 직접 호출.
 *
 * 로그인은 nProtect 키패드(자동 타이핑 불가) → 헤드풀 사람 로그인(requiresHuman=true).
 * 응답은 `{"mbw_result":"S","mbw_json":{...}}` 평문 JSON (base64/zlib 없음). 세션 쿠키 인증(토큰 불필요).
 * 월납입금 = mthPayMentent.mRlPytRetAt (= 공급가 + 부가세). 상세 SHINHAN-NOTES.md.
 *
 * 수집: carBrand→carModel→carLineUp(세부모델)→carTrim (P01.ajax)
 *   → per 트림: getDeliveryInfo → per(기간×거리): getCarRate(잔존율)+mthPayMentent → mRlPytRetAt.
 */

const BASE = "/adp/ADPFM860N";
// 계약기간(개월) × 거리코드 → RATE_KEY 거리(km). 거리코드는 e2e 로 확정(1=1만 추정).
const RATE_CELLS: { month: number; distCode: string; dist: number }[] = [
  { month: 36, distCode: "1", dist: 10000 }, { month: 36, distCode: "2", dist: 20000 }, { month: 36, distCode: "3", dist: 30000 },
  { month: 48, distCode: "1", dist: 10000 }, { month: 48, distCode: "2", dist: 20000 }, { month: 48, distCode: "3", dist: 30000 },
  { month: 60, distCode: "1", dist: 10000 }, { month: 60, distCode: "2", dist: 20000 }, { month: 60, distCode: "3", dist: 30000 },
];

const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 400);
function cfg<T>(config: Record<string, unknown> | null, key: string, fallback: T): T {
  const v = config?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}
/** "000000000822580" → 822580 */
const num = (s: unknown): number => Number(String(s ?? "").replace(/[^\d.-]/g, "")) || 0;

class SessionExpired extends Error {}

/** POST .ajax → mbw_json. HTML(세션만료) 시 단순 재시도 후 SessionExpired.
 *  신한은 쿠키 폭증 없음(508B) → 쿠키 삭제 안 함(계산 세션 쿠키를 지우면 mbw_result=F 유발). */
async function ajax(ctx: AdapterContext, endpoint: string, params: Record<string, string>, _retried = false): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const raw: string = await ctx.page.evaluate(async (ep, b) => {
    const r = await fetch(ep, { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body: b });
    return await r.text();
  }, endpoint, body).catch((e: Error) => `__FETCHERR__${e.message}`);
  if (raw.startsWith("__FETCHERR__")) {
    if (!_retried) { await sleep(1000); return ajax(ctx, endpoint, params, true); }
    throw new Error(raw.slice(12));
  }
  const t = raw.trim();
  if (/^<(!doctype|html)/i.test(t)) {
    // 신한은 쿠키 폭증 없음(508B) → 쿠키 삭제 금지(계산 세션 쿠키 지우면 mbw_result=F). 단순 재시도만.
    if (!_retried) { await sleep(800); return ajax(ctx, endpoint, params, true); }
    ctx.log(`[HTML응답] ${endpoint} → 세션만료 추정`);
    throw new SessionExpired();
  }
  let j: any;
  try { j = JSON.parse(t); } catch { throw new Error(`JSON 파싱 실패: ${t.slice(0, 60)}`); }
  if (j.mbw_result && j.mbw_result !== "S") {
    const type = params.type ?? params.selectType ?? "";
    throw new Error(`mbw_result=${j.mbw_result} [${type}] ${String(j.mbw_message ?? j.mbw_code ?? "").replace(/\s+/g, " ").slice(0, 60)}`);
  }
  return j.mbw_json ?? j;
}

/** 병렬배열 응답 {a:[],b:[]} → [{a,b},...] */
function zip(obj: any): any[] {
  if (!obj) return [];
  const keys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
  const n = keys.length ? obj[keys[0]].length : 0;
  const rows: any[] = [];
  for (let i = 0; i < n; i++) { const r: any = {}; for (const k of keys) r[k] = obj[k][i]; rows.push(r); }
  return rows;
}

const P01 = (ctx: AdapterContext, params: Record<string, string>) => ajax(ctx, `${BASE}/ADPFM860P01.ajax`, params);
const R02 = (ctx: AdapterContext, params: Record<string, string>) => ajax(ctx, `${BASE}/ADPFM860R02.ajax`, params);

/** mthPayMentent 요청 파라미터 (캡처 기준 상수 + 가변). 단일 셀(1기간) 계산 → mRlPytRetAt1. */
function calcParams(o: {
  carMdlCd: string; brdId: string; mdlId: string; dlMdlId: string; trimId: string;
  exhQty: string; price: number; fuel: string; rgAgcAfoN: string; cggAt: number; colorId: string;
  month: number; distCode: string; ruvRt: number; ppnRt: number; gymRt: number; gymAt: number;
}): Record<string, string> {
  return {
    type: "mthPayMentent", priceType: "0",
    carMdlCd: o.carMdlCd, dnwaCarBrdId: o.brdId, dnwaCarMdlId: o.mdlId, dnwaCarDlMdlId: o.dlMdlId, dnwaCarTrimId: o.trimId,
    dnwaCarTrimExhQtyVl: o.exhQty, carPrice: String(o.price), optCdList: "", optionPrice: "0", colorPrice: "0",
    exOloId: o.colorId, inOloId: o.colorId, suppliesCdData: "", suppliesAtData: "",
    vhTowCcd: "10", vhRgAgcCcd: "30", sdyCgmGnCd: "1", dca: "0", cggAt: String(o.cggAt),
    fncClnCcdGubn: "1", dctPdF: "N", reuF: "N", bdSffExvIuJnF: "N", mclIuDcF: "N", rntcCnaRyCcd: "",
    iuJnAgeCd: "26", carIuAgatIdfCd: "30", carIuMyvhIdfCd: "60",
    caRtList: "0.00", caAtList: "0", cmRtList: "0.00", cmAtList: "0",
    esmTrmMsCnList: String(o.month), rntcPdCcdList: "03", anlCtcDsaVlList: o.distCode,
    esmPpnRtList: String(o.ppnRt), esmPpnAtList: "0", esmGymRtList: String(o.gymRt), esmGymAtList: String(o.gymAt),
    esmPpnCk: "P", esmGymCk: "P", ruvRtList: String(o.ruvRt), tupTcdList: "4",
    rgAgcAfoN: o.rgAgcAfoN, vhPhaRqN: "", cslMtt: "", tthClnNm: "", bneAidUsrGelXpoF: "Y",
    vhPhaGovSsiAt: "0", dnwaCarOokCcdNm: o.fuel, fncEsmN: "",
  };
}

interface CollectResult { baseRates: Record<string, number>; warnings: string[]; depositRate36_10000?: number; prepayRate36_10000?: number }

/** 트림의 유효 색상코드(exOloId) 조회 — P02.ajax carColorList 에서 무료색(없으면 첫 색). 색상은 모델별이라 필수. */
async function getColorId(ctx: AdapterContext, b: TrimBase): Promise<string> {
  try {
    const p02 = await ajax(ctx, `${BASE}/ADPFM860P02.ajax`, { dnwaCarBrdId: b.brdId, dnwaCarMdlId: b.mdlId, dnwaCarDlMdlId: b.dlMdlId, dnwaCarTrimId: b.trimId, carMdlCd: b.carMdlCd, dnwaCarBrdNm: b.brandName, dnwaCarMdlNm: b.modelName, dnwaCarDlMdlNm: b.dlMdlName, dnwaCarTrimNm: b.trimName });
    const colors = zip(p02?.carColorList);
    const free = colors.find((c) => num(c.dnwaCarOloAt) === 0) ?? colors[0];
    return String(free?.dnwaCarOloId ?? "");
  } catch { return ""; }
}

interface TrimBase {
  carMdlCd: string; brdId: string; mdlId: string; dlMdlId: string; trimId: string; exhQty: string; price: number; fuel: string;
  brandName: string; modelName: string; dlMdlName: string; trimName: string;
}

/** 트림 1건의 9칸 월납입금 + 36/1만 보증10%·선납10% 수집. */
async function collectTrim(ctx: AdapterContext, base: TrimBase, opts?: { skipDepositPrepay?: boolean }): Promise<CollectResult> {
  const warnings: string[] = [];
  const baseRates: Record<string, number> = {};

  // 탁송/등록 정보 (rgAgcAfoN·공채) + 유효 색상코드
  const dlv = await R02(ctx, { type: "getDeliveryInfo", vhTowCcd: "10", carMdlCd: base.carMdlCd, dnwaCarBrdId: base.brdId, dnwaCarMdlId: base.mdlId, dnwaCarDlMdlId: base.dlMdlId, dnwaCarTrimId: base.trimId, optCdList: "", vhPhaRqN: "", gubn: "Y" });
  const rgAgcAfoN = String(dlv?.rgAgcAfoN ?? "");
  const cggAt = num(dlv?.cggAt);
  const colorId = await getColorId(ctx, base);

  const ruvOf = async (month: number, distCode: string): Promise<number> => {
    const selNum = month === 36 ? "1" : month === 48 ? "2" : "3";
    const rate = await R02(ctx, { type: "getCarRate", carMdlCd: base.carMdlCd, lnTrmMsCn: String(month), anlCtcDsaVl: distCode, rntcPdCcd: "03", selNum, exOloId: "", inOloId: "" });
    // 잔존율 = maxRuvRt(최고 잔존율=최저납입금, UI 기본) ÷100. 응답은 mbw_json.rateInfo 에 중첩.
    // max=0 = 해당 모델 견적불가(신한 잔존율 미설정) → 0 반환 → mthPayMentent 실패 → 셀 스킵.
    return Math.round(num((rate?.rateInfo ?? rate)?.maxRuvRt) / 100);
  };

  // 셀끼리는 서로 의존하지 않는다(calcParams 에 잔존율까지 모두 실어 보냄) → 동시 처리.
  // 결과·경고 순서는 mapPool 이 입력 순서로 유지한다. 순차로 되돌리려면 SCRAPER_PACE=safe.
  const cells = await mapPool(RATE_CELLS, cellConcurrency(ctx.config), async (c) => {
    try {
      const ruvRt = await ruvOf(c.month, c.distCode);
      await sleep(reqDelay(ctx.config));
      const res = await R02(ctx, calcParams({ ...base, exhQty: base.exhQty, rgAgcAfoN, cggAt, colorId, month: c.month, distCode: c.distCode, ruvRt, ppnRt: 0, gymRt: 0, gymAt: 0 }));
      const pay = num(res?.mRlPytRetAt1);
      return { pay, ruvRt, warn: pay > 0 ? null : `${c.month}/${c.dist} 산출 0` };
    } catch (e) {
      // 견적불가 셀(잔존율 데이터 없음 등)은 건너뛰고 나머지 칸 계속 — 트림 전체를 죽이지 않음
      return { pay: 0, ruvRt: undefined as number | undefined, warn: `${c.month}/${c.dist}: ${(e as Error).message.slice(0, 30)}` };
    }
  });
  RATE_CELLS.forEach((c, i) => {
    const r = cells[i];
    if (r.pay > 0) baseRates[`${c.month}_${c.dist}`] = r.pay;
    if (r.warn) warnings.push(r.warn);
  });

  let depositRate36_10000: number | undefined;
  let prepayRate36_10000: number | undefined;
  if (!opts?.skipDepositPrepay && baseRates["36_10000"]) {
    // 36/1만 셀에서 이미 받은 잔존율 재사용 (같은 값 — getCarRate 재호출 불필요)
    const ruvRt = cells[0].ruvRt ?? (await ruvOf(36, "1"));
    const tenP = Math.round((base.price * 0.1) / 1000) * 1000;
    try {
      const dep = await R02(ctx, calcParams({ ...base, rgAgcAfoN, cggAt, colorId, month: 36, distCode: "1", ruvRt, ppnRt: 0, gymRt: 10, gymAt: tenP }));
      if (num(dep?.mRlPytRetAt1) > 0) depositRate36_10000 = num(dep.mRlPytRetAt1);
      await sleep(reqDelay(ctx.config));
      const pre = await R02(ctx, calcParams({ ...base, rgAgcAfoN, cggAt, colorId, month: 36, distCode: "1", ruvRt, ppnRt: 10, gymRt: 0, gymAt: 0 }));
      if (num(pre?.mRlPytRetAt1) > 0) prepayRate36_10000 = num(pre.mRlPytRetAt1);
    } catch (e) {
      warnings.push(`보증/선납 오류: ${(e as Error).message.slice(0, 40)}`);
    }
  }
  return { baseRates, warnings, depositRate36_10000, prepayRate36_10000 };
}

const yearOf = (s: string): string => (String(s).match(/(20\d{2})/) || [])[1] ?? "";

export const shinhanAdapter: SiteAdapter = {
  code: "SHINHAN",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, log } = ctx;
    log(`로그인: ${credentials.loginUrl}`);
    await page.goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1000);
    const needLogin = await page.evaluate(() => !/ADPFM860R01/.test(location.href) && !!document.querySelector("input[type='password'], #keypadArea, .keypad"));
    if (needLogin) {
      await ctx.waitForHuman("신한카드 로그인을 워커 브라우저에서 완료(사번 ID + 키패드 비밀번호)한 뒤 [재개]를 누르세요.");
    }
    // 견적 메인(R01.shc)으로 이동해 세션 확립
    const estUrl = new URL(credentials.loginUrl);
    estUrl.pathname = cfg(ctx.config, "estimatePath", "/adp/ADPFM860N/ADPFM860R01.shc");
    await page.goto(estUrl.toString(), { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
    await sleep(1200);
    // 세션 확인 — init 호출 성공해야 로그인 완료
    const init = await R02(ctx, { type: "init", vhPhaRqN: "", fncEsmN: "" }).catch(() => null);
    if (!init || !init.userName) throw new AuthError("신한카드 세션 확인 실패(로그인 미완료 추정).");
    log(`세션 확보 (${init.jdcBnNm ?? ""})`);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await R02(ctx, { type: "init", vhPhaRqN: "", fncEsmN: "" }).catch(() => null);
  },

  async scrapeTrim(_ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    return { trimId: ourTrimId, matchConfidence: "unmatched", externalTrimLabel: "(SHINHAN trim_rates 미지원 — 카탈로그 수집 사용)", vehiclePrice: 0, baseRates: {}, warnings: ["SHINHAN 은 카탈로그 수집만 지원합니다."] };
  },

  // 선택 브랜드의 차량(모델) 목록만 (models 잡). 브랜드당 요청 1회 — 라인업·트림은 긁지 않는다.
  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { log } = ctx;
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      const rows = zip((await P01(ctx, { selectType: "carModel", dnwaCarBrdId: brand.brandCd, dnwaCarBrdNm: brand.name }))?.carModelList);
      const models = rows
        .map((m) => ({ modelCd: String(m.dnwaCarMdlId ?? ""), modelName: String(m.dnwaCarMdlNm ?? m.dnwaCarMdlId ?? "") }))
        .filter((m) => m.modelCd);
      log(`[차량목록] ${brand.name}(${brand.brandCd}) — ${models.length}개`);
      await opts.onBrandModels(brand, models);
      total += models.length;
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, models: models.length });
      await sleep(reqDelay(ctx.config));
    }
    return { total, brands: brandSummaries };
  },

  async scrapeCatalog(ctx: AdapterContext, opts: CatalogScrapeOptions): Promise<CatalogScrapeResult> {
    const { log } = ctx;
    let total = 0, skipped = 0, failed = 0, trimsDone = 0, trimsTotal = 0;
    const brandSummaries: CatalogScrapeResult["brands"] = [];
    const failures: CatalogFailure[] = [];

    for (let bi = 0; bi < opts.brands.length; bi++) {
      const brand = opts.brands[bi];
      if (ctx.isCanceled()) break;
      const allModels = zip((await P01(ctx, { selectType: "carModel", dnwaCarBrdId: brand.brandCd, dnwaCarBrdNm: brand.name }))?.carModelList);
      const models = pickModels(allModels, brand.modelCds, (m) => String(m.dnwaCarMdlId));
      log(`[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${models.length}개${brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allModels.length}개)` : ""}`);
      let brandTrims = 0;

      for (let mi = 0; mi < models.length; mi++) {
        const model = models[mi];
        if (ctx.isCanceled()) break;
        const modelName = String(model.dnwaCarMdlNm ?? model.dnwaCarMdlId);
        let lineups: any[];
        try {
          lineups = zip((await P01(ctx, { selectType: "carLineUp", dnwaCarBrdId: brand.brandCd, dnwaCarMdlId: model.dnwaCarMdlId, dnwaCarBrdNm: brand.name, dnwaCarMdlNm: modelName }))?.carDtlSearchList);
        } catch (e) {
          failed++; log(`[카탈로그] 모델 ${modelName} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          pushFailure(failures, `${brand.name} ${modelName}`, `모델 정보 로드 실패: ${(e as Error).message.slice(0, 50)}`); continue;
        }

        // 트림 목록 (세부모델별)
        const trimRows: { lineup: any; trim: any }[] = [];
        for (const lineup of lineups) {
          try {
            const trims = zip((await P01(ctx, { selectType: "carTrim", dnwaCarBrdId: brand.brandCd, dnwaCarMdlId: model.dnwaCarMdlId, dnwaCarDlMdlId: lineup.dnwaCarDlMdlId, dnwaCarBrdNm: brand.name, dnwaCarMdlNm: modelName, dnwaCarDlMdlNm: String(lineup.dnwaCarDlMdlNm ?? "") }))?.carTrimList);
            for (const trim of trims) trimRows.push({ lineup, trim });
          } catch { /* 라인업 스킵 */ }
          await sleep(reqDelay(ctx.config));
        }
        trimsTotal += trimRows.length;
        log(`[카탈로그] ${brand.name} ${modelName} — 트림 ${trimRows.length}개`);
        opts.onProgress({ phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name, modelIdx: mi + 1, modelCount: models.length, modelName, trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString() });

        for (const { lineup, trim } of trimRows) {
          if (ctx.isCanceled()) break;
          trimsDone++;
          const carMdlCd = `${model.dnwaCarMdlId}${trim.dnwaCarTrimId}`;
          if (opts.isCollected(carMdlCd)) { skipped++; continue; }
          const price = num(trim.dnwaCarTrimTowAtOri);
          const lineupName = String(lineup.dnwaCarDlMdlNm ?? "");
          const trimLabel = `${lineupName} ${trim.dnwaCarTrimNm ?? ""}`.trim();
          const modelYear = yearOf(String(lineup.dnwaCarYdtVl ?? lineupName));
          try {
            const r = await collectTrim(ctx, { carMdlCd, brdId: brand.brandCd, mdlId: String(model.dnwaCarMdlId), dlMdlId: String(lineup.dnwaCarDlMdlId), trimId: String(trim.dnwaCarTrimId), exhQty: String(trim.dnwaCarTrimExhQtyVl ?? ""), price, fuel: String(trim.dnwaCarOokCcdNm ?? ""), brandName: brand.name, modelName, dlMdlName: lineupName, trimName: String(trim.dnwaCarTrimNm ?? "") });
            if (Object.keys(r.baseRates).length === 0) {
              failed++;
              pushFailure(failures, `${modelName} ${trimLabel}`, r.warnings[0] ?? "월납입금 산출 0건");
            }
            const entry: CatalogTrimEntry = {
              brandCd: brand.brandCd, brandName: brand.name,
              modelCd: String(model.dnwaCarMdlId), modelName,
              dtMdlCd: String(lineup.dnwaCarDlMdlId), dtMdlName: lineupName || undefined,
              mdelCd: carMdlCd, trimName: trimLabel,
              modelYear: modelYear || undefined, vehiclePrice: price,
              baseRates: r.baseRates, warnings: r.warnings,
              depositRate36_10000: r.depositRate36_10000, prepayRate36_10000: r.prepayRate36_10000,
            };
            await opts.onTrimResult(entry);
            total++; brandTrims++;
          } catch (e) {
            failed++; log(`[카탈로그] ${trimLabel} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
            pushFailure(failures, `${modelName} ${trimLabel}`, (e as Error).message.slice(0, 60));
          }
          await sleep(reqDelay(ctx.config));
        }
        await opts.onModelDone(String(model.dnwaCarMdlId));
        await sleep(400 + rand(0, 300));
      }
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: brandTrims });
    }
    return { total, skipped, failed, brands: brandSummaries, failures };
  },
};

import { AuthError, pushFailure } from "./types";
import type { CatalogFailure } from "./types";
import type { AdapterContext, CatalogScrapeOptions, CatalogScrapeResult, ModelListOptions, ModelListResult, SiteAdapter } from "./types";
import type { CatalogTrimEntry, TrimScrapeResult } from "../../../src/types/scraper";
import { assertHttpUrl } from "../safe-url";
import { rand, reqDelay as paceDelay, sleep } from "../pace";
import { pickModels } from "../model-filter";

/**
 * JB우리캐피탈(JBWOORI) 장기렌트 월납입금 수집 어댑터 — **DOM 자동화** 방식.
 *
 * JB 견적 계산 API(getComEstInpm/setRentBaseSrvcsInfo/getResultRent)는 메모리 상태객체
 * `estmData`+`vhclData` 를 `flattenSteps()` 로 직렬화해 보내는 **상태형**이라, 캡처 body 재생이
 * 원천 불가(동일 세션 즉시 재전송도 500). 따라서 사이트 자체 JS 로 위저드를 구동한다:
 *   ① 트림 로드: vhclData 를 스토리지(jsalrnt0160Env)에 세팅 → 견적페이지 리로드 → jsalrnt0155.lfVhclInitInfo(1)
 *   ② 정비제외 선택(imprvGdsCd_01)
 *   ③ per 셀(기간×거리): loanTrm_01 라디오 click + agreDstnCd_01 change → 잔존율 재계산 대기 → jsalrnt0155.lfEstm() → #popEstm01RentfeArea
 * 열거(제조사/차종/트림)는 내부 JSON API(getVehicleList/getVhclKncrLis/getVhclDtlList, headless 200)로 수행.
 * 로그인은 RaonSecure 키패드 + SMS 2차인증 → 헤드풀 사람 로그인(requiresHuman=true). 상세 JBWOORI-NOTES.md.
 */

const RNT = "/sale/ncr/rnt";
const ESTIMATE_URL = "https://emp.wooricap.com/sale/ncr/rnt/mdSaleRnt0163.do";

// 계약기간(개월) × JB 거리코드 → 매트릭스 거리(km).
// JB 는 1만km 옵션이 없어(최소 1.2만) 1.2만(16)을 10000 슬롯으로 근사 — 타 캐피탈사와 RATE_KEY 일관성 유지.
// 실제 거리: 16=1.2만·02=2만·03=3만.
const RATE_CELLS: { month: number; distCode: string; dist: number }[] = [
  { month: 36, distCode: "16", dist: 10000 }, { month: 36, distCode: "02", dist: 20000 }, { month: 36, distCode: "03", dist: 30000 },
  { month: 48, distCode: "16", dist: 10000 }, { month: 48, distCode: "02", dist: 20000 }, { month: 48, distCode: "03", dist: 30000 },
  { month: 60, distCode: "16", dist: 10000 }, { month: 60, distCode: "02", dist: 20000 }, { month: 60, distCode: "03", dist: 30000 },
];

function cfg<T>(config: Record<string, unknown> | null, key: string, fallback: T): T {
  const v = config?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}
const reqDelay = (config: Record<string, unknown> | null): number => paceDelay(config, 400);
/** "14,930,000원" → 14930000 */
const num = (s: unknown): number => Number(String(s ?? "").replace(/[^\d.-]/g, "")) || 0;

/** 병렬배열 응답 {a:[],b:[]} → [{a,b}]. JB 는 대개 객체배열이라 배열이면 그대로 반환. */
function rows(obj: any): any[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter((x) => x && typeof x === "object");
  const keys = Object.keys(obj).filter((k) => Array.isArray(obj[k]));
  const n = keys.length ? obj[keys[0]].length : 0;
  const out: any[] = [];
  for (let i = 0; i < n; i++) { const r: any = {}; for (const k of keys) r[k] = obj[k][i]; out.push(r); }
  return out;
}

/** 내부 JSON API POST (열거용). 세션 쿠키 인증. */
async function apiPost(ctx: AdapterContext, path: string, params: Record<string, string>): Promise<any> {
  const body = new URLSearchParams(params).toString();
  const raw: string = await ctx.page.evaluate(async (u, b) => {
    const r = await fetch(u, { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body: b });
    return await r.text();
  }, path, body).catch((e: Error) => `__ERR__${e.message}`);
  if (raw.startsWith("__ERR__")) throw new Error(raw.slice(7));
  const t = raw.trim();
  if (/^<(!doctype|html)/i.test(t)) throw new AuthError("JBWOORI 세션 만료(HTML 응답) — 재로그인 필요.");
  try { return JSON.parse(t); } catch { throw new Error(`JSON 파싱 실패: ${t.slice(0, 60)}`); }
}

interface TrimRow {
  makrCd: string; makrSeqno: number; dmdmImrtDvcd: number;
  cmdtCd: string; cmdtDtlsCd: string; cmdtClcd: string; vhclPrc: number;
  setr: number; dsvl: string; rentUzYn: string; rentIneart: number; leasIneart: number;
  atmbEngeTycd: string; pbndKncrDvcd: string; xtaxAplyYn: string; indvCnsmtxAplyYn: string;
  mcrNntryEsnYn: string; cmdtNm: string; aqtxReduYn: string; frdmRtnPosbYn: string; cmdtDtlsNm: string;
}

interface JbSelection {
  prop(name: string, value: boolean): JbSelection;
  trigger(event: string): JbSelection;
  val(value: string): JbSelection;
}

declare global {
  interface Window {
    jbwrcUtil?: { storageUtil: { set(key: string, value: object): void } };
    jsalrnt0155?: { lfVhclInitInfo(mode: number): void; lfEstm(): void };
    jQuery?: (target: string | Element) => JbSelection;
  }
}

/** getVhclDtlList 트림 객체 → vhclData(스토리지 jsalrnt0160Env) 구조. 누락 4필드는 상수 기본값. */
function toTrimRow(t: any): TrimRow {
  return {
    makrCd: String(t.makrCd), makrSeqno: num(t.makrSeqno), dmdmImrtDvcd: num(t.dmdmImrtDvcd),
    cmdtCd: String(t.cmdtCd), cmdtDtlsCd: String(t.cmdtDtlsCd), cmdtClcd: String(t.cmdtClcd ?? ""), vhclPrc: num(t.cmdtAmt),
    setr: num(t.setr), dsvl: String(t.dsvl ?? ""), rentUzYn: String(t.rentUzYn ?? "Y"),
    rentIneart: num(t.rentIneart), leasIneart: num(t.leasIneart),
    atmbEngeTycd: String(t.atmbEngeTycd ?? "01"), pbndKncrDvcd: String(t.pbndKncrDvcd ?? "9"),
    xtaxAplyYn: String(t.xtaxAplyYn ?? "N"), indvCnsmtxAplyYn: String(t.indvCnsmtxAplyYn ?? "N"),
    mcrNntryEsnYn: String(t.mcrNntryEsnYn ?? " "), cmdtNm: String(t.cmdtNm ?? ""),
    aqtxReduYn: String(t.aqtxReduYn ?? "Y"), frdmRtnPosbYn: String(t.frdmRtnPosbYn ?? "Y"), cmdtDtlsNm: String(t.cmdtDtlsNm ?? ""),
  };
}

/** 트림을 견적폼에 로드: 스토리지 vhclData 세팅 → 리로드 → lfVhclInitInfo → 정비제외 선택. 실패 시 throw. */
async function loadTrim(ctx: AdapterContext, t: TrimRow, modelName: string): Promise<void> {
  const { page, config } = ctx;
  // 1) vhclData 스토리지 세팅 (누락 필드는 상수: strtCnsgAreaCd=026 공장출발, insuGrad=01, credRelfCmdtYn="")
  await page.evaluate((t, modlNm) => {
    const nv = {
      dmdmImrtDvcd: t.dmdmImrtDvcd, makrCd: t.makrCd, makrSeqno: t.makrSeqno,
      cmdtCd: t.cmdtCd, cmdtDtlsCd: t.cmdtDtlsCd, cmdtClcd: t.cmdtClcd, vhclPrc: t.vhclPrc,
      setr: t.setr, dsvl: t.dsvl, strtCnsgAreaCd: "026", rentUzYn: t.rentUzYn,
      rentIneart: t.rentIneart, leasIneart: t.leasIneart, atmbEngeTycd: t.atmbEngeTycd,
      insuGrad: "01", pbndKncrDvcd: t.pbndKncrDvcd, xtaxAplyYn: t.xtaxAplyYn,
      indvCnsmtxAplyYn: t.indvCnsmtxAplyYn, mcrNntryEsnYn: t.mcrNntryEsnYn,
      cmdtNm: t.cmdtNm, modlNm, credRelfCmdtYn: "", aqtxReduYn: t.aqtxReduYn,
      frdmRtnPosbYn: t.frdmRtnPosbYn, cmdtDtlsNm: t.cmdtDtlsNm,
    };
    if (!window.jbwrcUtil) throw new Error("JBWOORI storage API를 찾지 못했습니다.");
    window.jbwrcUtil.storageUtil.set("jsalrnt0160Env", nv);
  }, t, modelName);

  // 2) 견적페이지 리로드 → 견적폼이 스토리지 vhclData 로 초기화
  //    고정 대기 대신 견적폼에 트림명이 실제로 반영될 때까지 폴링 — 확인 조건은 같고(3번 검사와 동일)
  //    대개 훨씬 빨리 끝난다. domReloadWaitMs 는 이제 '최대 대기'로 동작.
  await page.goto(ESTIMATE_URL, { waitUntil: "networkidle2", timeout: 45000 });
  const loaded = await page
    .waitForFunction(
      (name: string) => {
        const txt = (document.getElementById("vhclCmdtNm")?.textContent || "").trim();
        return txt && txt.includes(name) ? txt : null;
      },
      { timeout: cfg(config, "domReloadWaitMs", 8000), polling: 200 },
      t.cmdtDtlsNm
    )
    .then((h) => h.jsonValue() as Promise<string>)
    .catch(() => "");

  // 3) 로드 확인 + 색상/잔존율 init
  if (!loaded) {
    const shown = await page.evaluate(() => (document.getElementById("vhclCmdtNm")?.textContent || "").trim()).catch(() => "");
    throw new Error(`트림 로드 확인 실패(표시="${shown.slice(0, 30)}")`);
  }
  await page.evaluate(() => {
    if (!window.jsalrnt0155) throw new Error("JBWOORI 견적 초기화 API를 찾지 못했습니다.");
    window.jsalrnt0155.lfVhclInitInfo(1);
  });
  // init 이 내는 색상·잔존율 호출이 끝날 때까지 — 네트워크가 조용해지면 진행(최대 domInitWaitMs).
  await page.waitForNetworkIdle({ idleTime: 500, timeout: cfg(config, "domInitWaitMs", 4000) }).catch(() => null);

  // 4) 정비제외 선택 (imprvGdsCd_01 옵션 텍스트 '정비제외')
  const imprvOk = await page.evaluate(() => {
    const $ = window.jQuery;
    if (!$) return false;
    const sel = document.getElementById("imprvGdsCd_01") as HTMLSelectElement | null;
    if (!sel) return false;
    const opt = Array.from(sel.options).find((o) => /정비제외/.test(o.text));
    if (!opt) return false;
    sel.value = opt.value; $(sel).trigger("change");
    return true;
  });
  if (!imprvOk) throw new Error("정비제외 옵션을 찾지 못함");
  await page.waitForNetworkIdle({ idleTime: 400, timeout: cfg(config, "domResidualWaitMs", 2000) }).catch(() => null);
}

/**
 * 셀 1개 계산: col1 기간/거리 세팅 → 잔존율 재계산 완료 대기 → lfEstm() → getResultRent 완료 대기 → #popEstm01RentfeArea.
 * 고정 sleep 은 stale(잔존율 재계산 전 lfEstm) 유발 → 네트워크 응답을 기다린 뒤 settle. 견적불가/오류 시 0.
 */
async function computeCell(ctx: AdapterContext, month: number, distCode: string): Promise<number> {
  const { page, config } = ctx;
  // 거리/기간 변경 → setRentBaseSrvcsInfo(잔존율) 발생. 응답 완료를 기다려 stale 방지.
  const residual = page.waitForResponse((r) => /setRentBaseSrvcsInfo\.do/.test(r.url()), { timeout: 20000 }).catch(() => null);
  await page.evaluate(({ month, distCode }) => {
    const $ = window.jQuery;
    if (!$) throw new Error("JBWOORI jQuery API를 찾지 못했습니다.");
    const r = $(`input[name=loanTrm_01][value="${month}"]`);
    r.prop("checked", true); r.trigger("click");
    const s = $("#agreDstnCd_01");
    s.val(distCode); s.trigger("change");
  }, { month, distCode });
  await residual;
  // 라디오·셀렉트가 각각 잔존율 호출을 내므로 마지막 호출·콜백(estmData 반영)까지 settle.
  // 고정 sleep 대신 네트워크가 조용해질 때까지 — 두 번째 호출도 함께 기다리고 최대치는 종전과 같다.
  await page.waitForNetworkIdle({ idleTime: 400, timeout: cfg(config, "domResidualSettleMs", 1600) }).catch(() => null);
  // lfEstm() → getResultRent. 응답 완료 후 콜백이 #popEstm01RentfeArea 갱신.
  const prev = await page.evaluate(() => (document.getElementById("popEstm01RentfeArea")?.textContent || "").trim());
  const result = page.waitForResponse((r) => /getResultRent\.do/.test(r.url()), { timeout: 20000 }).catch(() => null);
  await page.evaluate(() => {
    if (!window.jsalrnt0155) throw new Error("JBWOORI 견적 계산 API를 찾지 못했습니다.");
    window.jsalrnt0155.lfEstm();
  });
  await result;
  // 콜백이 결과영역을 갱신할 때까지 폴링(최대 domCalcSettleMs — 종전 고정 대기와 같은 상한).
  // 직전 셀과 값이 같으면 폴링이 못 잡으므로 상한까지 기다린 뒤 현재 값을 읽는다(= 종전 동작).
  const changed = await page
    .waitForFunction(
      (p: string) => {
        const s = (document.getElementById("popEstm01RentfeArea")?.textContent || "").trim();
        return s && s !== p ? s : null;
      },
      { timeout: cfg(config, "domCalcSettleMs", 900), polling: 100 },
      prev
    )
    .then((h) => h.jsonValue() as Promise<string>)
    .catch(() => null);
  const txt = changed ?? (await page.evaluate(() => (document.getElementById("popEstm01RentfeArea")?.textContent || "").trim()));
  return num(txt);
}

interface CollectResult { baseRates: Record<string, number>; warnings: string[] }

/** 트림 1건의 9칸 월납입금 수집. (JB 보증10%/선납10% DOM 컨트롤 미확인 → 현재 미수집.) */
async function collectTrim(ctx: AdapterContext, t: TrimRow, modelName: string): Promise<CollectResult> {
  const warnings: string[] = [];
  const baseRates: Record<string, number> = {};
  await loadTrim(ctx, t, modelName);
  for (const c of RATE_CELLS) {
    if (ctx.isCanceled()) break;
    try {
      const pay = await computeCell(ctx, c.month, c.distCode);
      if (pay > 0) baseRates[`${c.month}_${c.dist}`] = pay;
      else warnings.push(`${c.month}/${c.dist} 산출 0`);
    } catch (e) {
      warnings.push(`${c.month}/${c.dist}: ${(e as Error).message.slice(0, 30)}`);
    }
  }
  return { baseRates, warnings };
}

const yearOf = (s: string): string => (String(s).match(/(20\d{2})/) || [])[1] ?? "";

export const jbwooriAdapter: SiteAdapter = {
  code: "JBWOORI",

  async login(ctx: AdapterContext): Promise<void> {
    const { page, credentials, log } = ctx;
    log(`로그인: ${credentials.loginUrl}`);
    await page.goto(assertHttpUrl(credentials.loginUrl, "loginUrl"), { waitUntil: "networkidle2", timeout: 45000 });
    await sleep(1000);
    const loggedIn = await page.evaluate(() => /mdSaleMai|mdSaleRnt/.test(location.href));
    if (!loggedIn) {
      await ctx.waitForHuman("JB우리캐피탈 로그인을 워커 브라우저에서 완료(RaonSecure 키패드 + SMS 인증)한 뒤 [재개]를 누르세요.");
    }
    // 견적 페이지로 이동해 세션 확립
    await page.goto(ESTIMATE_URL, { waitUntil: "networkidle2", timeout: 45000 }).catch(() => null);
    await sleep(1200);
    // 세션 확인 — getVehicleList 성공해야 로그인 완료
    const veh = await apiPost(ctx, `${RNT}/getVehicleList.do`, { makrNatCd: "KR", chnlGdsDvcd: "T", straBuynKncrYn: "", credRelfCmdtYn: "" }).catch(() => null);
    if (!veh || rows(veh.vehicleManufacturerList).length === 0) throw new AuthError("JBWOORI 세션 확인 실패(로그인 미완료 추정).");
    log(`세션 확보 (제조사 ${rows(veh.vehicleManufacturerList).length}개)`);
  },

  async keepAlive(ctx: AdapterContext): Promise<void> {
    await apiPost(ctx, `${RNT}/getVehicleList.do`, { makrNatCd: "KR", chnlGdsDvcd: "T", straBuynKncrYn: "", credRelfCmdtYn: "" }).catch(() => null);
  },

  async scrapeTrim(_ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult> {
    return { trimId: ourTrimId, matchConfidence: "unmatched", externalTrimLabel: "(JBWOORI trim_rates 미지원 — 카탈로그 수집 사용)", vehiclePrice: 0, baseRates: {}, warnings: ["JBWOORI 은 카탈로그 수집만 지원합니다."] };
  },

  // 선택 브랜드의 차량(모델=클래스) 목록만 (models 잡). 브랜드당 요청 1회 — 차종·트림은 긁지 않는다.
  async listModels(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult> {
    const { log } = ctx;
    let total = 0;
    const brandSummaries: ModelListResult["brands"] = [];

    for (const brand of opts.brands) {
      if (ctx.isCanceled()) break;
      let classes: any[];
      try {
        classes = rows((await apiPost(ctx, `${RNT}/getVhclClssList.do`, { chnlGdsDvcd: "T", makrCd: brand.brandCd, dmdmImrtDvcd: "1", straBuynKncrYn: "", credRelfCmdtYn: "" }))?.vhclClssList).filter((c) => c.makrSeqno);
      } catch (e) {
        log(`[차량목록] ${brand.name} 로드 실패: ${(e as Error).message.slice(0, 50)}`);
        brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, models: 0 });
        continue;
      }
      const models = classes.map((c) => ({ modelCd: String(c.makrSeqno), modelName: String(c.modlNm ?? c.makrSeqno) }));
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
      // 계층: 제조사 → 클래스(모델시리즈, getVhclClssList) → 차종(getVhclKncrLis) → 트림(getVhclDtlList).
      // makrSeqno 는 클래스별 값이라 반드시 클래스 순회로 필터해야 함(""=전체 164 반환 → 브랜드 오귀속).
      let allClasses: any[];
      try {
        allClasses = rows((await apiPost(ctx, `${RNT}/getVhclClssList.do`, { chnlGdsDvcd: "T", makrCd: brand.brandCd, dmdmImrtDvcd: "1", straBuynKncrYn: "", credRelfCmdtYn: "" }))?.vhclClssList).filter((c) => c.makrSeqno);
      } catch (e) {
        failed++; log(`[카탈로그] 브랜드 ${brand.name} 클래스 로드 실패: ${(e as Error).message.slice(0, 50)}`);
        pushFailure(failures, `브랜드 ${brand.name}`, `모델 목록 로드 실패: ${(e as Error).message.slice(0, 50)}`);
        brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: 0 }); continue;
      }
      const classes = pickModels(allClasses, brand.modelCds, (c) => String(c.makrSeqno));
      log(`[카탈로그] 브랜드 ${brand.name}(${brand.brandCd}) — 모델 ${classes.length}개${brand.modelCds?.length ? ` (차량 선택 수집 / 전체 ${allClasses.length}개)` : ""}`);
      let brandTrims = 0;

      for (let ci = 0; ci < classes.length; ci++) {
        const cls = classes[ci];
        if (ctx.isCanceled()) break;
        const modelName = String(cls.modlNm ?? cls.makrSeqno);
        // 클래스 내 차종(세부모델=연식/엔진)
        let subModels: any[];
        try {
          subModels = rows((await apiPost(ctx, `${RNT}/getVhclKncrLis.do`, { chnlGdsDvcd: "T", dmdmImrtDvcd: "1", makrCd: brand.brandCd, makrSeqno: String(cls.makrSeqno), straBuynKncrYn: "", credRelfCmdtYn: "" }))?.vhclKncrLis).filter((m) => m.cmdtCd);
        } catch (e) {
          failed++; log(`[카탈로그] 모델 ${modelName} 차종 로드 실패: ${(e as Error).message.slice(0, 50)}`);
          pushFailure(failures, `${brand.name} ${modelName}`, `차종 목록 로드 실패: ${(e as Error).message.slice(0, 50)}`); continue;
        }
        opts.onProgress({ phase: "scraping", brandIdx: bi + 1, brandCount: opts.brands.length, brandName: brand.name, modelIdx: ci + 1, modelCount: classes.length, modelName, trimsDone, trimsTotal, skipped, updatedAt: new Date().toISOString() });

        for (const sub of subModels) {
          if (ctx.isCanceled()) break;
          const subName = String(sub.cmdtNm ?? sub.cmdtCd);
          let trims: any[];
          try {
            trims = rows((await apiPost(ctx, `${RNT}/getVhclDtlList.do`, { chnlGdsDvcd: "T", cmdtCd: String(sub.cmdtCd), straBuynKncrYn: "", credRelfCmdtYn: "" }))?.vhclDtlList).filter((t) => t.cmdtDtlsCd);
          } catch (e) {
            failed++; log(`[카탈로그] 차종 ${subName} 트림 로드 실패: ${(e as Error).message.slice(0, 50)}`);
            pushFailure(failures, `${modelName} ${subName}`, `트림 목록 로드 실패: ${(e as Error).message.slice(0, 50)}`); continue;
          }
          trimsTotal += trims.length;
          log(`[카탈로그] ${brand.name} ${modelName} ${subName} — 트림 ${trims.length}개`);

          for (const rawTrim of trims) {
            if (ctx.isCanceled()) break;
            trimsDone++;
            const t = toTrimRow(rawTrim);
            const mdelCd = `${t.cmdtCd}_${t.cmdtDtlsCd}`;
            if (opts.isCollected(mdelCd)) { skipped++; continue; }
            const modelYear = yearOf(subName);
            try {
              const r = await collectTrim(ctx, t, modelName);
              if (Object.keys(r.baseRates).length === 0) {
                failed++;
                pushFailure(failures, `${modelName} ${t.cmdtDtlsNm}`, r.warnings[0] ?? "월납입금 산출 0건");
              }
              const entry: CatalogTrimEntry = {
                brandCd: brand.brandCd, brandName: brand.name,
                modelCd: String(cls.makrSeqno), modelName,
                dtMdlCd: t.cmdtCd, dtMdlName: subName,
                mdelCd, trimName: t.cmdtDtlsNm,
                modelYear: modelYear || undefined, vehiclePrice: t.vhclPrc,
                baseRates: r.baseRates, warnings: r.warnings,
              };
              await opts.onTrimResult(entry);
              total++; brandTrims++;
            } catch (e) {
              failed++; log(`[카탈로그] ${t.cmdtDtlsNm} 수집 실패: ${(e as Error).message.slice(0, 60)}`);
              pushFailure(failures, `${modelName} ${t.cmdtDtlsNm}`, (e as Error).message.slice(0, 60));
            }
            await sleep(reqDelay(ctx.config));
          }
          await opts.onModelDone(String(sub.cmdtCd));
        }
        await sleep(400 + rand(0, 300));
      }
      brandSummaries.push({ brandCd: brand.brandCd, name: brand.name, trims: brandTrims });
    }
    return { total, skipped, failed, brands: brandSummaries, failures };
  },
};

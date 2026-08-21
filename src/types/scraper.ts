import type { RateSheetRaw } from "@/types/admin";

/**
 * 캐피탈사 회수율 자동 수집 기능의 공유 타입.
 * 백엔드 API, 로컬 워커(scripts/scraper-worker), 관리자 UI 가 함께 사용한다.
 */

export type ScrapeJobStatus =
  | "pending"
  | "running"
  | "needs_human"
  | "completed"
  | "failed"
  | "canceled";

export type TrimMatchConfidence = "exact" | "fuzzy" | "unmatched";

export type ScrapeJobType = "trim_rates" | "catalog" | "models";

/** trim_rates 잡: 어드민이 작업 생성 시 넘기고, 워커가 수집 대상으로 사용하는 파라미터. */
export interface ScrapeJobParams {
  trimIds: string[];
  vehicleId: string;
  lineupIds: string[];
  weekOf: string; // "YYYY-MM-DD"
  minVehiclePrice: number;
  maxVehiclePrice: number;
  // 캐피탈사 차량 연결(차량 scraperRefs[캐피탈사]) + 트림명 — 워커 이름 자동매칭용
  scraperRef?: { brandCd: string; modelName: string };
  trims?: { trimId: string; name: string }[];
}

/** catalog 잡: 선택 브랜드의 캐피탈사 등록 전 모델·전 트림을 원본 그대로 수집. */
export interface CatalogJobParams {
  mode: "catalog";
  /** modelCds 를 주면 그 모델만, 비우면 브랜드 전량. */
  brands: { brandCd: string; name: string; modelCds?: string[] }[];
  weekOf: string; // "YYYY-MM-DD"
  productType: string;
}

/**
 * models 잡: 선택 브랜드의 차량(모델) 목록만 가져온다.
 * 트림 견적을 긁지 않아 브랜드당 수 초면 끝난다 — 수집 대상 차량을 고르기 전에 한 번 돌린다.
 */
export interface ModelsJobParams {
  mode: "models";
  brands: { brandCd: string; name: string }[];
  productType: string;
}

/** models 잡이 가져온 차량 1건 — CapitalCatalogModel 에 upsert 된다. */
export interface CatalogModelEntry {
  brandCd: string;
  brandName: string;
  modelCd: string;
  modelName: string;
}

/** models 잡 결과 요약. */
export interface ModelsJobSummary {
  mode: "models";
  total: number;
  brands: { brandCd: string; name: string; models: number }[];
  finishedAt: string;
}

/** 카탈로그 수집 트림 1건 — 워커가 증분 저장 라우트로 보내고 CapitalCatalogTrim 에 upsert 된다. */
export interface CatalogTrimEntry {
  brandCd: string;
  brandName: string;
  modelCd: string;
  modelName: string;
  dtMdlCd: string;
  dtMdlName?: string;
  mdelCd: string;
  trimName: string;
  modelYear?: string;
  vehiclePrice: number;
  baseRates: Partial<RateSheetRaw>; // RATE_KEYS → 월납입금(원)
  depositRate36_10000?: number; // 36개월/1만km 보증금10% 월납입금(원)
  prepayRate36_10000?: number; // 36개월/1만km 선납금10% 월납입금(원)
  warnings: string[];
}

/** catalog 잡 진행률 — 워커 하트비트가 갱신, 어드민 GET 이 반환. */
export interface CatalogProgress {
  phase: "scraping" | "done";
  brandIdx: number;
  brandCount: number;
  brandName: string;
  modelIdx: number;
  modelCount: number;
  modelName: string;
  trimsDone: number;
  trimsTotal: number; // 현재 모델까지 파악된 누계 (사전 전수조사 없이 증분 갱신)
  skipped: number;
  updatedAt: string; // ISO
}

/** catalog 잡 완료 요약 — ScrapeJob.draft 에 저장. */
export interface CatalogScrapeSummary {
  mode: "catalog";
  total: number;
  skipped: number;
  failed: number;
  brands: { brandCd: string; name: string; trims: number }[];
  /** 이번 실행에서 실제 수집된 차량별 트림 수 — 워커가 entry 스트림에서 집계(스킵분 제외). 구버전 워커 결과엔 없다. */
  models?: { brandName: string; modelName: string; trims: number }[];
  /** 실패 내역(무엇이 왜) — 어댑터가 상한 30건까지 수집. 구버전 워커 결과엔 없다. */
  failures?: { label: string; reason: string }[];
  finishedAt: string; // ISO
}

/**
 * 워커가 채워 ScrapeJob.draft 에 저장하는 초안.
 * 기존 저장 API(POST /api/admin/capital-rates) Body 및 RateInputForm state 와 1:1 로 매핑되어
 * 추가 변환 없이 그대로 검토-후-반영에 사용된다.
 */
export interface ScrapeDraft {
  scrapedAt: string; // ISO
  productType: string; // "장기렌트" | "리스"
  weekOf: string; // "YYYY-MM-DD"
  trims: Array<{
    trimId: string;
    matchConfidence: TrimMatchConfidence;
    externalTrimLabel: string; // 사이트 원본 라벨 (운영자 검증용)
    vehiclePrice: number;
    // 트림별 월 지불액(원) — 라인업별 그룹핑(라인업 자체 min/max 산출)용
    baseRates?: RateSheetRaw;
    depositRates?: RateSheetRaw;
    prepayRates?: RateSheetRaw;
  }>;
  minVehiclePrice: number;
  maxVehiclePrice: number;
  // RATE_KEYS("36_10000" … "60_30000") 키, 값은 월 지불액(원). 0 = 미수집.
  minBaseRates: RateSheetRaw;
  minDepositRates: RateSheetRaw; // 36_10000 셀만 유효 (RateInputForm 규약)
  minPrepayRates: RateSheetRaw; // 36_10000 셀만 유효
  maxBaseRates: RateSheetRaw;
  maxDepositRates: RateSheetRaw;
  maxPrepayRates: RateSheetRaw;
  warnings: string[];
}

/** 워커 어댑터가 트림 1개를 수집해 반환하는 결과 (mapping.ts 가 ScrapeDraft 로 조립). */
export interface TrimScrapeResult {
  trimId: string;
  matchConfidence: TrimMatchConfidence;
  externalTrimLabel: string;
  vehiclePrice: number;
  baseRates: Partial<RateSheetRaw>; // RATE_KEYS → 원
  depositRate36_10000?: number;
  prepayRate36_10000?: number;
  warnings: string[];
}

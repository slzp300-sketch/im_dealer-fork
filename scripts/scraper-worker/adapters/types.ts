import type { Page } from "puppeteer";
import type { CatalogJobParams, CatalogProgress, CatalogTrimEntry, ModelsJobParams, ScrapeJobParams, TrimScrapeResult } from "../../../src/types/scraper";

/**
 * 자격증명(ID/PW) 오류로 인한 로그인 실패.
 * 워커가 이걸 감지하면 재시도하지 않고 해당 자격증명을 비활성화한다 — 잘못된 비번으로
 * 반복 로그인해 캐피탈사 계정이 잠기는 것을 방지(자기유발 잠금 차단).
 * (2FA/일시 네트워크 오류 등은 일반 Error 로 두어 이 경로를 타지 않게 한다.)
 */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AdapterCredentials {
  username: string;
  password: string;
  loginUrl: string;
}

/** 어댑터가 한 작업을 처리하는 동안 받는 실행 컨텍스트. */
export interface AdapterContext {
  page: Page;
  credentials: AdapterCredentials;
  config: Record<string, unknown> | null;
  params: ScrapeJobParams | CatalogJobParams | ModelsJobParams;
  log: (msg: string) => void;
  /**
   * 사람 개입(2FA·키보드보안 등)이 필요할 때 호출.
   * 작업을 needs_human 으로 전환하고 어드민이 [재개]를 누를 때까지 대기한다.
   * 취소되면 throw 한다.
   */
  waitForHuman: (prompt: string) => Promise<void>;
  /** 어드민이 작업을 취소했는지 확인. */
  isCanceled: () => boolean;
}

/** catalog 잡 옵션 — 순회는 어댑터가, 버퍼링/flush/스킵 판정 데이터는 워커가 소유한다. */
export interface CatalogScrapeOptions {
  /** modelCds 가 있으면 그 모델만 순회한다(차량 단위 수집). 비어있으면 브랜드 전량. */
  brands: { brandCd: string; name: string; modelCds?: string[] }[];
  /** 이번주 이미 수집된 외부 트림코드면 true — 어댑터는 수집을 건너뛴다(재개 지원). */
  isCollected: (mdelCd: string) => boolean;
  /** 트림 1건 수집 완료 시 호출 — 워커가 버퍼에 쌓고 모델 경계/20건마다 flush. */
  onTrimResult: (entry: CatalogTrimEntry) => Promise<void>;
  /** 모델(MDL_CD) 경계 — 워커가 버퍼를 flush 한다. */
  onModelDone: (modelCd: string) => Promise<void>;
  /** 진행률 갱신 — 워커가 하트비트에 동봉한다. */
  onProgress: (p: CatalogProgress) => void;
}

/** models 잡 옵션 — 트림 견적 없이 차량(모델) 목록만 모은다. */
export interface ModelListOptions {
  brands: { brandCd: string; name: string }[];
  /** 브랜드 1개분 목록이 모이면 호출 — 워커가 저장하고 진행률을 갱신한다. */
  onBrandModels: (
    brand: { brandCd: string; name: string },
    models: { modelCd: string; modelName: string }[]
  ) => Promise<void>;
}

export interface ModelListResult {
  total: number;
  brands: { brandCd: string; name: string; models: number }[];
}

/** 실패 1건의 표시용 요약 — 완료 카드에서 "무엇이 왜" 실패했는지 보여준다. */
export interface CatalogFailure {
  label: string; // 실패 지점 (트림·모델·차종 이름)
  reason: string; // 짧은 사유 (콘솔 로그와 동일 수준)
}

/** 실패 내역은 표시용 상한까지만 쌓는다 — draft(JSON 컬럼) 비대 방지. failed 카운트는 별도로 전량 센다. */
export const MAX_CATALOG_FAILURES = 30;
export function pushFailure(list: CatalogFailure[], label: string, reason: string) {
  if (list.length < MAX_CATALOG_FAILURES) list.push({ label, reason: reason.slice(0, 80) });
}

export interface CatalogScrapeResult {
  total: number; // 수집(저장 시도)한 트림 수
  skipped: number; // 이번주 기수집으로 건너뛴 수
  failed: number; // 월납입금 0건 등 수집 실패 수
  brands: { brandCd: string; name: string; trims: number }[];
  failures?: CatalogFailure[]; // 실패 내역 (상한 MAX_CATALOG_FAILURES 건)
}

/**
 * 캐피탈사 사이트별 어댑터.
 * 사이트마다 로그인 흐름·연장 버튼·견적 표 구조가 달라 어댑터로 격리한다.
 */
export interface SiteAdapter {
  readonly code: string;
  /** 로그인 (필요 시 ctx.waitForHuman 으로 사람 인증 단계 위임). */
  login(ctx: AdapterContext): Promise<void>;
  /** 세션 연장 ("연장" 버튼 클릭 등). keepAlive 인터벌에서 주기 호출됨. */
  keepAlive(ctx: AdapterContext): Promise<void>;
  /** 우리 trimId 1개에 대한 견적/회수율 수집. */
  scrapeTrim(ctx: AdapterContext, ourTrimId: string): Promise<TrimScrapeResult>;
  /** 선택 브랜드의 캐피탈사 등록 전 모델·전 트림 수집 (catalog 잡). 미구현 어댑터 = 미지원. */
  scrapeCatalog?(ctx: AdapterContext, opts: CatalogScrapeOptions): Promise<CatalogScrapeResult>;
  /** 선택 브랜드의 차량(모델) 목록만 수집 (models 잡). 미구현 어댑터 = 미지원. */
  listModels?(ctx: AdapterContext, opts: ModelListOptions): Promise<ModelListResult>;
}

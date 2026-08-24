import { z } from "zod";
import { overlapProfileSchema } from "@/lib/recommend/overlap-profile";
import { WORKER_ID_PATTERN } from "@/lib/scraper/job-state";

// ─── Vehicle ────────────────────────────────────────────
export const scraperRefsSchema = z.record(
  z.string(),
  z.object({ brandCd: z.string(), modelName: z.string() })
);

const vehicleFields = {
  name: z.string().min(1, "차량명을 입력하세요"),
  brand: z.string().min(1, "브랜드를 입력하세요"),
  category: z.enum(["세단", "SUV", "밴", "트럭"]),
  basePrice: z.number().int().positive("기준가는 양수여야 합니다"),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  isVisible: z.boolean().default(true),
  isPopular: z.boolean().default(false),
  isSpotlight: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  surchargeRate: z.number().default(0),
  vehicleCode: z.string().optional(),
  slidingDoorOverride: z.boolean().nullable().optional(),
  advancedSafetyOverride: z.boolean().nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(20)).max(10).optional(),
  // 캐피탈사 회수율 스크래퍼 연결 (캐피탈사 코드 → { 브랜드코드, 모델명 })
  scraperRefs: scraperRefsSchema.nullable().optional(),
} as const;

export const vehicleCreateSchema = z.object(vehicleFields).strict();

export const vehicleUpdateSchema = z.object(vehicleFields).partial().strict();

// 차량 노출 순서 일괄 저장: 전달된 id 배열 순서대로 displayOrder(0,1,2…) 부여
export const vehicleReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "정렬할 차량이 없습니다").max(500),
});

// ─── Brand ──────────────────────────────────────────────
export const brandCreateSchema = z.object({
  name: z.string().min(1, "브랜드명을 입력하세요").max(40),
  logoUrl: z.string().url().nullable().optional(),
  displayOrder: z.number().int().default(0),
  isFeatured: z.boolean().default(false),
});

export const brandUpdateSchema = z
  .object({
    name: z.string().min(1, "브랜드명을 입력하세요").max(40).optional(),
    logoUrl: z.string().url().nullable().optional(),
    displayOrder: z.number().int().optional(),
    isFeatured: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "수정할 항목이 없습니다.",
  });

// ─── Lineup ─────────────────────────────────────────────
export const lineupCreateSchema = z.object({
  name: z.string().min(1, "라인업명을 입력하세요"),
});

export const lineupUpdateSchema = z
  .object({
    name: z.string().min(1, "라인업명을 입력하세요").optional(),
    isVisible: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "수정할 항목이 없습니다." });

// ─── Trim ───────────────────────────────────────────────
export const trimCreateSchema = z.object({
  name: z.string().min(1, "트림명을 입력하세요"),
  lineupId: z.string().min(1, "라인업을 선택하세요"),
  price: z.number().int().positive("가격은 양수여야 합니다"),
  discountPrice: z.number().int().positive().nullable().optional(),
  // 전기차 보조금(안내용, 견적 미반영). 0 이상 또는 null(미입력=보조금 없음).
  evSubsidy: z.number().int().min(0, "보조금은 0 이상이어야 합니다").nullable().optional(),
  engineType: z.enum(["가솔린", "디젤", "하이브리드", "EV"]),
  isDefault: z.boolean().default(false),
  isVisible: z.boolean().default(true),
  fuelEfficiency: z.number().nullable().optional(),
  specs: z.record(z.string()).nullable().optional(),
});

export const trimUpdateSchema = trimCreateSchema.partial();

// ─── TrimOption ─────────────────────────────────────────
export const optionCreateSchema = z.object({
  name: z.string().min(1, "옵션명을 입력하세요"),
  price: z.number().int().min(0, "가격은 0 이상이어야 합니다"),
  category: z.string().nullable().optional(),
  isDefault: z.boolean().default(false),
  isAccessory: z.boolean().default(false),
  description: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
});

export const optionUpdateSchema = optionCreateSchema.partial();

// 옵션 노출 순서 일괄 저장: id 배열 순서대로 displayOrder(0,1,2…) 부여
export const optionReorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "정렬할 옵션이 없습니다").max(500),
});

// ─── OptionBadge (추천 배지 라벨 관리) ──────────────────
export const optionBadgeCreateSchema = z.object({
  label: z.string().min(1, "배지 문구를 입력하세요").max(20, "배지 문구는 20자 이하여야 합니다"),
  displayOrder: z.number().int().default(0),
});

export const optionBadgeUpdateSchema = z
  .object({
    label: z.string().min(1, "배지 문구를 입력하세요").max(20).optional(),
    displayOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "수정할 항목이 없습니다." });

// ─── VehicleOptionBadge (차량 단위 옵션명 → 배지 지정) ──
// badgeId: null 이면 해당 옵션명의 배지 해제
export const vehicleOptionBadgeSetSchema = z.object({
  optionName: z.string().min(1, "옵션명이 비어 있습니다").max(200),
  badgeId: z.string().min(1).nullable(),
});

// ─── VehicleColor ───────────────────────────────────────
const HEX_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const vehicleColorCreateSchema = z.object({
  kind: z.enum(["EXTERIOR", "INTERIOR"]),
  name: z.string().min(1, "색상명을 입력하세요").max(60),
  hexCode: z.string().regex(HEX_REGEX, "Hex 색상 코드는 #RRGGBB 형식이어야 합니다"),
  imageUrl: z
    .string()
    .max(1000)
    .refine((v) => v.startsWith("/") || /^https?:\/\//.test(v), {
      message: "이미지 URL은 절대 URL 또는 / 로 시작하는 경로여야 합니다",
    })
    .nullable()
    .optional(),
  priceDelta: z.number().int().min(0, "추가요금은 0 이상이어야 합니다").default(0),
  isDefault: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

export const vehicleColorUpdateSchema = vehicleColorCreateSchema.partial();

// ─── OptionRule ─────────────────────────────────────────
export const ruleCreateSchema = z.object({
  ruleType: z.enum(["REQUIRED", "INCLUDED", "CONFLICT"]),
  sourceOptionId: z.string().min(1, "기준 옵션을 선택하세요"),
  targetOptionId: z.string().min(1, "대상 옵션을 선택하세요"),
});

// ─── PopularConfig ──────────────────────────────────────
export const popularConfigItemSchema = z.object({
  name: z.string().min(1, "항목명을 입력하세요"),
  price: z.number().int().min(0, "가격은 0 이상이어야 합니다"),
  trimOptionId: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
});

export const popularConfigCreateSchema = z.object({
  name: z.string().min(1, "구성명을 입력하세요"),
  note: z.string().nullable().optional(),
  displayOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
  items: z.array(popularConfigItemSchema).default([]),
});

export const popularConfigUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
  displayOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  items: z.array(popularConfigItemSchema).optional(),
});

// ─── Inventory ──────────────────────────────────────────
export const inventoryCreateSchema = z.object({
  vehicleSlug: z.string().min(1, "차량 slug 가 필요합니다"),
  trimName: z.string().min(1, "트림명이 필요합니다"),
  financeCompanyName: z.string().optional(),
  stockCount: z.number().int().min(0).max(9999),
  immediateDelivery: z.boolean().default(false),
  colorExt: z.string().max(50).optional(),
  selectedOptions: z.array(z.string().max(200)).max(50).default([]),
  memo: z.string().max(2000).optional(),
});

export const inventoryUpdateSchema = z.object({
  stockCount: z.number().int().min(0).max(9999).optional(),
  immediateDelivery: z.boolean().optional(),
  colorExt: z.string().max(50).optional(),
  selectedOptions: z.array(z.string().max(200)).max(50).optional(),
  memo: z.string().max(2000).optional(),
  financeCompanyName: z.string().optional(),
  trimName: z.string().min(1).optional(),
  vehicleName: z.string().optional(),
  // 옵티미스틱 락: 클라이언트가 마지막으로 본 updatedAt (ISO 문자열).
  // 누락 시 락 비활성화(하위 호환).
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

// ─── AI Recommendation Config ───────────────────────────
const aiConfigMetadataShape = {
  highlights: z.array(z.string().max(200)).max(20).optional(),
  aiCaption: z.string().max(1000).nullable().optional(),
};

const aiConfigCreateSchema = z.object({
  action: z.literal("create"),
  vehicleId: z.string().min(1, "vehicleId가 필요합니다"),
  expectedUpdatedAt: z.never().optional(),
  profile: overlapProfileSchema,
  isActive: z.boolean(),
  ...aiConfigMetadataShape,
}).strict();

const aiConfigUpdateSchema = z.object({
  action: z.literal("update"),
  vehicleId: z.string().min(1, "vehicleId가 필요합니다"),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  profile: overlapProfileSchema,
  isActive: z.boolean(),
  ...aiConfigMetadataShape,
}).strict();

const aiConfigDeactivateSchema = z.object({
  action: z.literal("deactivate"),
  vehicleId: z.string().min(1, "vehicleId가 필요합니다"),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();

export const aiConfigMutationSchema = z.union([
  aiConfigUpdateSchema,
  aiConfigCreateSchema,
  aiConfigDeactivateSchema,
]);

// ─── 캐피탈사 회수율 스크래핑 ───────────────────────────
const rateSheetRawSchema = z.record(z.string(), z.number());

// 작업 생성 (POST /api/admin/scrape-jobs)
export const scrapeJobCreateSchema = z.object({
  financeCompanyId: z.string().min(1),
  productType: z.string().min(1).default("장기렌트"),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekOf 형식은 YYYY-MM-DD"),
  trimIds: z.array(z.string().min(1)).min(1, "트림을 1개 이상 선택하세요"),
  vehicleId: z.string().min(1),
  lineupIds: z.array(z.string().min(1)).default([]),
  minVehiclePrice: z.number().int().positive(),
  maxVehiclePrice: z.number().int().positive(),
  // 가져오기마다 관리자가 직접 입력하는 개인 캐피탈 로그인 (저장하지 않음).
  // requiresHuman 캐피탈사(키패드·SMS)는 워커가 자격증명을 쓰지 못하므로 생략한다 — 라우트에서 검증.
  username: z.string().optional(),
  password: z.string().optional(),
  // 이 작업을 처리할 수집 PC 이름. 비우면 아무 워커나 집는다.
  workerId: z.string().regex(WORKER_ID_PATTERN, "수집 PC 이름 형식이 올바르지 않습니다").optional(),
});

// 카탈로그 전량 수집 작업 생성 (POST /api/admin/scrape-jobs, body.jobType === "catalog")
export const catalogJobCreateSchema = z.object({
  jobType: z.literal("catalog"),
  financeCompanyId: z.string().min(1),
  productType: z.string().min(1).default("장기렌트"),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekOf 형식은 YYYY-MM-DD"),
  brands: z
    .array(
      z.object({
        brandCd: z.string().min(1),
        name: z.string().min(1),
        // 차량(모델) 단위 수집 — 비우면 브랜드 전량. 브랜드 전량은 수십 분 걸려 부분 재수집용으로 필요.
        modelCds: z.array(z.string().min(1)).optional(),
      })
    )
    .min(1, "브랜드를 1개 이상 선택하세요"),
  // requiresHuman 캐피탈사는 생략 가능 — 위 scrapeJobCreateSchema 주석 참고.
  username: z.string().optional(),
  password: z.string().optional(),
  workerId: z.string().regex(WORKER_ID_PATTERN, "수집 PC 이름 형식이 올바르지 않습니다").optional(),
});

// 차량(모델) 목록 동기화 작업 생성 (POST /api/admin/scrape-jobs, body.jobType === "models")
// 트림 견적을 긁지 않고 목록만 가져온다 — 수집 대상 차량 선택 전에 브랜드당 한 번 돌린다.
export const modelsJobCreateSchema = z.object({
  jobType: z.literal("models"),
  financeCompanyId: z.string().min(1),
  productType: z.string().min(1).default("장기렌트"),
  brands: z
    .array(z.object({ brandCd: z.string().min(1), name: z.string().min(1) }))
    .min(1, "브랜드를 1개 이상 선택하세요"),
  // requiresHuman 캐피탈사는 생략 가능 — 위 scrapeJobCreateSchema 주석 참고.
  username: z.string().optional(),
  password: z.string().optional(),
  workerId: z.string().regex(WORKER_ID_PATTERN, "수집 PC 이름 형식이 올바르지 않습니다").optional(),
});

// 트림 매핑 upsert (POST /api/admin/capital-catalog/mappings)
export const catalogMappingUpsertSchema = z.object({
  financeCompanyId: z.string().min(1),
  trimId: z.string().min(1),
  productType: z.string().min(1).default("장기렌트"),
  catalogTrimId: z.string().min(1),
  source: z.enum(["auto", "manual"]),
  confidence: z.enum(["exact", "fuzzy"]).nullish(),
});

// 카탈로그 → 정확값 시트 반영 (POST /api/admin/capital-rates/apply-catalog)
export const applyCatalogSchema = z.object({
  financeCompanyId: z.string().min(1),
  productType: z.enum(["장기렌트", "리스", "금융리스", "할부"]).default("장기렌트"),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekOf 형식은 YYYY-MM-DD"),
  trimIds: z.array(z.string().min(1)).min(1, "트림을 1개 이상 선택하세요"),
  // true 면 시트를 쓰지 않고 트림별 반영 가능 여부·사유만 돌려준다 (반영 전 미리보기용)
  dryRun: z.boolean().optional(),
});

// 작업 상태 변경 (PATCH /api/admin/scrape-jobs/[id])
export const scrapeJobActionSchema = z.object({
  action: z.enum(["cancel", "resume"]),
});

// 워커 결과 보고 (POST /api/worker/scrape-jobs/[id]/result)
// catalog 잡 완료 요약 (워커 → ScrapeJob.draft 저장)
export const catalogScrapeSummarySchema = z.object({
  mode: z.literal("catalog"),
  total: z.number().int().min(0),
  skipped: z.number().int().min(0),
  failed: z.number().int().min(0),
  brands: z.array(z.object({ brandCd: z.string(), name: z.string(), trims: z.number().int().min(0) })),
  // 이번 실행에서 수집된 차량별 트림 수 (구버전 워커 결과엔 없음)
  models: z
    .array(z.object({ brandName: z.string(), modelName: z.string(), trims: z.number().int().min(0) }))
    .optional(),
  finishedAt: z.string(),
});

// models 잡 완료 요약 (워커 → ScrapeJob.draft 저장)
export const modelsJobSummarySchema = z.object({
  mode: z.literal("models"),
  total: z.number().int().min(0),
  brands: z.array(z.object({ brandCd: z.string(), name: z.string(), models: z.number().int().min(0) })),
  finishedAt: z.string(),
});

export const workerJobResultSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    // trim_rates 잡은 draft, catalog 잡은 catalogSummary, models 잡은 modelsSummary —
    // 라우트가 jobType 에 맞게 하나를 요구한다.
    catalogSummary: catalogScrapeSummarySchema.optional(),
    modelsSummary: modelsJobSummarySchema.optional(),
    draft: z.object({
      scrapedAt: z.string(),
      productType: z.string(),
      weekOf: z.string(),
      trims: z.array(
        z.object({
          trimId: z.string(),
          matchConfidence: z.enum(["exact", "fuzzy", "unmatched"]),
          externalTrimLabel: z.string(),
          vehiclePrice: z.number(),
          // 트림별 월 지불액(원) — 라인업별 그룹핑용 (없을 수 있음)
          baseRates: rateSheetRawSchema.optional(),
          depositRates: rateSheetRawSchema.optional(),
          prepayRates: rateSheetRawSchema.optional(),
        })
      ),
      minVehiclePrice: z.number(),
      maxVehiclePrice: z.number(),
      minBaseRates: rateSheetRawSchema,
      minDepositRates: rateSheetRawSchema,
      minPrepayRates: rateSheetRawSchema,
      maxBaseRates: rateSheetRawSchema,
      maxDepositRates: rateSheetRawSchema,
      maxPrepayRates: rateSheetRawSchema,
      warnings: z.array(z.string()),
    }).optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string().min(1),
    authFailed: z.boolean().optional(), // 자격증명 인증 실패 → 워커가 자격증명 비활성화 요청(잠금 방지)
  }),
]);

// 워커 하트비트 (POST /api/worker/scrape-jobs/[id]/heartbeat)
export const workerHeartbeatSchema = z.object({
  status: z.enum(["running", "needs_human"]).optional(),
  humanPrompt: z.string().optional(),
  progress: z.record(z.string(), z.unknown()).optional(), // catalog 잡 진행률 (정보성)
});

// 워커 카탈로그 증분 저장 (POST /api/worker/catalog/results)
// 워커 → 백엔드 차량(모델) 목록 저장 (POST /api/worker/catalog/models)
export const workerModelResultsSchema = z.object({
  jobId: z.string().min(1),
  financeCompanyId: z.string().min(1),
  productType: z.string().min(1),
  brandCd: z.string().min(1),
  brandName: z.string().min(1),
  // 브랜드에 등록 차량이 하나도 없을 수 있어 빈 배열을 허용한다(그 경우 기존 목록만 정리된다).
  models: z.array(z.object({ modelCd: z.string().min(1), modelName: z.string().min(1) })),
});

export const workerCatalogResultsSchema = z.object({
  jobId: z.string().min(1),
  financeCompanyId: z.string().min(1),
  productType: z.string().min(1),
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "weekOf 형식은 YYYY-MM-DD"),
  entries: z
    .array(
      z.object({
        brandCd: z.string().min(1),
        brandName: z.string().min(1),
        modelCd: z.string().min(1),
        modelName: z.string().min(1),
        dtMdlCd: z.string().min(1),
        dtMdlName: z.string().optional(),
        mdelCd: z.string().min(1),
        trimName: z.string().min(1),
        modelYear: z.string().optional(),
        vehiclePrice: z.number().int().min(0),
        baseRates: rateSheetRawSchema, // partial 허용 — 서버가 9칸으로 정규화
        depositRate36_10000: z.number().int().min(0).optional(),
        prepayRate36_10000: z.number().int().min(0).optional(),
        warnings: z.array(z.string()),
      })
    )
    .min(1),
});

// ─── Slug 생성 유틸 ─────────────────────────────────────
export function generateSlug(brand: string, name: string): string {
  const korean: Record<string, string> = {
    현대: "hyundai", 기아: "kia", 제네시스: "genesis",
    KGM: "kgm", BMW: "bmw", 벤츠: "benz",
  };
  const brandSlug = korean[brand] ?? brand.toLowerCase().replace(/\s+/g, "-");
  const nameSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .replace(/\s+/g, "-");
  return `${brandSlug}-${nameSlug}`;
}

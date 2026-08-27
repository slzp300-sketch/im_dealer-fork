/**
 * 차량 탐색 빠른 필터 칩 (UI 라벨).
 * body 타입(승용/RV/승합/화물)은 Vehicle.category 에 매핑하고,
 * EV/HEV 는 엔진(트림) 축으로 필터한다.
 */
export const VEHICLE_CATEGORIES = [
  "전체",
  "승용",
  "RV",
  "EV",
  "HEV",
  "승합",
  "화물",
] as const;

export type CategoryFilter = (typeof VEHICLE_CATEGORIES)[number];

/** UI 필터 → DB Vehicle.category (엔진 필터는 null) */
export const BODY_CATEGORY_MAP: Partial<Record<CategoryFilter, string>> = {
  승용: "세단",
  RV: "SUV",
  승합: "밴",
  화물: "트럭",
};

export function isEngineQuickFilter(filter: CategoryFilter): boolean {
  return filter === "EV" || filter === "HEV";
}

const HEV_NAME_RE = /하이브리드|HEV|PHEV/i;

/** 트림 목록에서 HEV 여부 판정 (engineType + 이름 보조) */
export function trimLooksHybrid(trim: {
  engineType?: string | null;
  name?: string | null;
}): boolean {
  const engine = (trim.engineType ?? "").trim();
  if (engine === "하이브리드" || /hybrid|hev|phev/i.test(engine)) return true;
  // EV 전용은 HEV로 치지 않음
  if (engine === "EV") return false;
  return HEV_NAME_RE.test(trim.name ?? "");
}

export function vehicleLooksHybrid(vehicle: {
  hasHev?: boolean;
  name?: string | null;
  defaultTrim?: { engineType?: string | null; name?: string | null } | null;
}): boolean {
  if (vehicle.hasHev === true) return true;
  if (vehicle.defaultTrim && trimLooksHybrid(vehicle.defaultTrim)) return true;
  return HEV_NAME_RE.test(vehicle.name ?? "");
}

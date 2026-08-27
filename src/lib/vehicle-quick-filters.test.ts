import { describe, expect, it } from "vitest";
import {
  BODY_CATEGORY_MAP,
  isEngineQuickFilter,
  trimLooksHybrid,
  vehicleLooksHybrid,
  VEHICLE_CATEGORIES,
} from "./vehicle-quick-filters";

describe("vehicle-quick-filters", () => {
  it("exposes body + powertrain chips", () => {
    expect(VEHICLE_CATEGORIES).toEqual([
      "전체",
      "승용",
      "RV",
      "EV",
      "HEV",
      "승합",
      "화물",
    ]);
    expect(BODY_CATEGORY_MAP.승용).toBe("세단");
    expect(BODY_CATEGORY_MAP.RV).toBe("SUV");
    expect(BODY_CATEGORY_MAP.승합).toBe("밴");
    expect(BODY_CATEGORY_MAP.화물).toBe("트럭");
    expect(isEngineQuickFilter("EV")).toBe(true);
    expect(isEngineQuickFilter("승용")).toBe(false);
  });

  it("detects hybrid trims by engineType or name", () => {
    expect(trimLooksHybrid({ engineType: "하이브리드" })).toBe(true);
    expect(trimLooksHybrid({ engineType: "가솔린", name: "그랜저 하이브리드" })).toBe(true);
    expect(trimLooksHybrid({ engineType: "EV", name: "아이오닉5" })).toBe(false);
    expect(trimLooksHybrid({ engineType: "가솔린", name: "쏘나타" })).toBe(false);
    expect(vehicleLooksHybrid({ hasHev: true })).toBe(true);
    expect(vehicleLooksHybrid({ name: "쏘렌토 HEV" })).toBe(true);
  });
});

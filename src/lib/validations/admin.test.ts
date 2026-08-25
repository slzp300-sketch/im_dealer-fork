import { describe, it, expect } from "vitest";
import {
  inventoryCreateSchema,
  inventoryUpdateSchema,
  aiConfigMutationSchema,
  popularConfigCreateSchema,
  catalogScrapeSummarySchema,
} from "./admin";
import { compileOverlapCatalog } from "@/lib/recommend/overlap-catalog";

describe("inventoryCreateSchema", () => {
  const valid = {
    vehicleSlug: "kia-ev9",
    trimName: "Earth",
    stockCount: 3,
    immediateDelivery: true,
  };

  it("accepts a valid payload", () => {
    expect(inventoryCreateSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(inventoryCreateSchema.safeParse({}).success).toBe(false);
    expect(
      inventoryCreateSchema.safeParse({ ...valid, vehicleSlug: "" }).success
    ).toBe(false);
  });

  it("rejects negative or oversized stockCount", () => {
    expect(
      inventoryCreateSchema.safeParse({ ...valid, stockCount: -1 }).success
    ).toBe(false);
    expect(
      inventoryCreateSchema.safeParse({ ...valid, stockCount: 100000 }).success
    ).toBe(false);
  });

  it("rejects non-integer stockCount", () => {
    expect(
      inventoryCreateSchema.safeParse({ ...valid, stockCount: 1.5 }).success
    ).toBe(false);
  });

  it("caps selectedOptions length", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `opt-${i}`);
    expect(
      inventoryCreateSchema.safeParse({ ...valid, selectedOptions: tooMany })
        .success
    ).toBe(false);
  });

  it("defaults immediateDelivery to false and selectedOptions to []", () => {
    const parsed = inventoryCreateSchema.parse({
      vehicleSlug: "x",
      trimName: "y",
      stockCount: 0,
    });
    expect(parsed.immediateDelivery).toBe(false);
    expect(parsed.selectedOptions).toEqual([]);
  });
});

describe("inventoryUpdateSchema", () => {
  it("accepts empty object (all optional)", () => {
    expect(inventoryUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("accepts ISO datetime for expectedUpdatedAt", () => {
    expect(
      inventoryUpdateSchema.safeParse({
        expectedUpdatedAt: "2026-05-01T12:00:00.000Z",
      }).success
    ).toBe(true);
  });

  it("rejects non-ISO string for expectedUpdatedAt", () => {
    expect(
      inventoryUpdateSchema.safeParse({ expectedUpdatedAt: "yesterday" })
        .success
    ).toBe(false);
  });
});

describe("aiConfigMutationSchema", () => {
  const profile = compileOverlapCatalog()[0]?.profile;

  it("accepts create, update, and deactivate boundaries", () => {
    expect(profile).toBeDefined();
    if (!profile) return;
    expect(aiConfigMutationSchema.safeParse({ action: "create", vehicleId: "vehicle", profile, isActive: true }).success).toBe(true);
    expect(aiConfigMutationSchema.safeParse({ action: "update", vehicleId: "vehicle", expectedUpdatedAt: "2026-07-12T00:00:00.000Z", profile, isActive: true }).success).toBe(true);
    expect(aiConfigMutationSchema.safeParse({ action: "deactivate", vehicleId: "vehicle", expectedUpdatedAt: "2026-07-12T00:00:00.000Z" }).success).toBe(true);
  });

  it("rejects legacy matrices and malformed v2 profiles", () => {
    expect(aiConfigMutationSchema.safeParse({ action: "create", vehicleId: "vehicle", profile: { fuel: { gasoline: 0.7 } }, isActive: true }).success).toBe(false);
    expect(aiConfigMutationSchema.safeParse({ action: "create", vehicleId: "vehicle", profile: { version: "overlap-v2" }, isActive: true }).success).toBe(false);
  });

  it("requires optimistic locking for deactivate and distinguishes create from update", () => {
    expect(aiConfigMutationSchema.safeParse({ action: "deactivate", vehicleId: "vehicle" }).success).toBe(false);
    expect(aiConfigMutationSchema.safeParse({ action: "update", vehicleId: "vehicle", profile, isActive: true }).success).toBe(false);
    expect(aiConfigMutationSchema.safeParse({ action: "update", vehicleId: "vehicle", expectedUpdatedAt: "not-a-date", profile, isActive: true }).success).toBe(false);
  });

  it("rejects oversized highlights array", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `h${i}`);
    expect(
      aiConfigMutationSchema.safeParse({ action: "create", vehicleId: "vehicle", profile, isActive: true, highlights: tooMany }).success
    ).toBe(false);
  });
});

describe("catalogScrapeSummarySchema", () => {
  const base = {
    mode: "catalog" as const,
    total: 12,
    skipped: 0,
    failed: 12,
    brands: [{ brandCd: "K", name: "기아", trims: 12 }],
    finishedAt: "2026-08-25T01:30:00.000Z",
  };

  it("preserves failures through parse (zod strips undeclared keys)", () => {
    const parsed = catalogScrapeSummarySchema.parse({
      ...base,
      failures: [{ label: "셀토스 시그니처", reason: "월납입금 산출 0건" }],
    });
    expect(parsed.failures).toEqual([
      { label: "셀토스 시그니처", reason: "월납입금 산출 0건" },
    ]);
  });

  it("accepts old-worker payloads without failures", () => {
    const parsed = catalogScrapeSummarySchema.parse(base);
    expect(parsed.failures).toBeUndefined();
  });
});

describe("popularConfigCreateSchema", () => {
  it("accepts a valid config", () => {
    const result = popularConfigCreateSchema.safeParse({
      name: "기본 구성",
      items: [
        { name: "썬루프", price: 1000000, displayOrder: 0 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative price", () => {
    const result = popularConfigCreateSchema.safeParse({
      name: "x",
      items: [{ name: "i", price: -1, displayOrder: 0 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(popularConfigCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

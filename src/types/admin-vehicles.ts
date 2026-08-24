import type { VehicleImageKind } from "./api";
import type { EngineType, VehicleCategory } from "./vehicle";

export interface AdminVehicleLite {
  id: string;
  brand: string;
  name: string;
  isVisible: boolean;
}

export interface AdminVehicle {
  id: string;
  slug: string;
  name: string;
  brand: string;
  category: VehicleCategory;
  vehicleCode: string | null;
  basePrice: number;
  thumbnailUrl: string;
  imageUrls: string[];
  surchargeRate: number;
  isVisible: boolean;
  isPopular: boolean;
  isSpotlight: boolean;
  slidingDoorOverride: boolean | null;
  advancedSafetyOverride: boolean | null;
  displayOrder: number;
  tags: string[];
  description: string | null;
  scraperRefs?: Record<string, { brandCd: string; modelName: string }> | null;
  createdAt: string;
  updatedAt: string;
  _count?: { trims: number };
}

export interface AdminVehicleDetail extends AdminVehicle {
  thumbnailImageId: string | null;
  imageRevision: number;
  images: AdminVehicleImage[];
  trims: AdminTrim[];
  lineups: AdminVehicleLineup[];
  popularConfigs?: AdminPopularConfig[];
  colors?: AdminVehicleColor[];
}

export interface AdminVehicleImage {
  readonly id: string;
  readonly type: VehicleImageKind;
  readonly origin: "CARPAN2" | "ADMIN";
  readonly title: string | null;
  readonly storageUrl: string;
  readonly sourceUrl: string | null;
  readonly sourceKey: string;
  readonly displayOrder: number;
  readonly isVisible: boolean;
  readonly deletedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isRepresentative: boolean;
}

export type ColorKind = "EXTERIOR" | "INTERIOR";

export interface AdminVehicleColor {
  id: string;
  vehicleId: string;
  kind: ColorKind;
  name: string;
  hexCode: string;
  imageUrl: string | null;
  priceDelta: number;
  isDefault: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPopularConfigItem {
  id: string;
  configId: string;
  name: string;
  price: number;
  trimOptionId: string | null;
  displayOrder: number;
}

export interface AdminPopularConfig {
  id: string;
  vehicleId: string;
  name: string;
  note: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: AdminPopularConfigItem[];
}

export interface AdminVehicleLineup {
  id: string;
  vehicleId: string;
  name: string;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTrim {
  id: string;
  vehicleId: string;
  lineupId: string | null;
  name: string;
  price: number;
  discountPrice: number | null;
  /** 전기차 보조금(안내용, 견적 미반영). null = 보조금 없음 */
  evSubsidy: number | null;
  engineType: EngineType;
  fuelEfficiency: number | null;
  isDefault: boolean;
  isVisible: boolean;
  specs: Record<string, string> | null;
  options: AdminTrimOption[];
  rules: AdminOptionRule[];
}

export interface AdminOptionRule {
  id: string;
  trimId: string;
  ruleType: "REQUIRED" | "INCLUDED" | "CONFLICT";
  sourceOptionId: string;
  targetOptionId: string;
  createdAt: string;
}

export interface AdminTrimOption {
  id: string;
  trimId: string;
  name: string;
  price: number;
  category: string | null;
  isDefault: boolean;
  isAccessory: boolean;
  description: string | null;
  displayOrder: number;
  /** 차량 단위 "옵션명 → 배지" 매핑(VehicleOptionBadge)에서 이름으로 해석된 배지 */
  badge: { id: string; label: string } | null;
}

/** 어드민 옵션 배지 일괄 지정 화면의 행 — 차량 전체 옵션명 목록 + 현재 배지 */
export interface AdminVehicleOptionBadgeRow {
  /** 정규화된 옵션명(매핑 키) */
  name: string;
  category: string | null;
  isAccessory: boolean;
  /** 이 옵션명이 포함된 트림 수 */
  trimCount: number;
  badgeId: string | null;
}

export interface AdminOptionBadge {
  id: string;
  label: string;
  displayOrder: number;
}

export interface AdminBrand {
  id: string;
  name: string;
  logoUrl: string | null;
  displayOrder: number;
  isFeatured: boolean;
  vehicleCount: number;
}

export interface AdminInventory {
  id: string;
  trimId: string;
  vehicleName: string;
  trimName: string;
  stockCount: number;
  location: string | null;
  status: "AVAILABLE" | "RESERVED" | "SOLD";
  colorExt: string | null;
  colorInt: string | null;
  vin: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

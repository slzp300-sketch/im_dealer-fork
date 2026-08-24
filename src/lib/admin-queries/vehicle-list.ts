import { getBrandSignals } from "@/lib/brand-signals";
import { makeBrandComparator } from "@/lib/brand-sort";
import { scraperRefsSchema } from "@/lib/validations/admin";
import type { AdminBrand, AdminVehicle, AdminVehicleLite } from "@/types/admin";
import { prisma } from "../prisma";

export async function getAdminVehiclesLite(): Promise<AdminVehicleLite[]> {
  return prisma.vehicle.findMany({
    select: { id: true, brand: true, name: true, isVisible: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
  });
}

export async function getAdminVehicles(brand?: string): Promise<AdminVehicle[]> {
  const vehicles = await prisma.vehicle.findMany({
    where: brand ? { brand } : undefined,
    orderBy: [{ displayOrder: "asc" }, { createdAt: "desc" }],
    include: { _count: { select: { trims: true } } },
  });

  return vehicles.map((vehicle) => {
    const scraperRefs = scraperRefsSchema.safeParse(vehicle.scraperRefs);
    return {
    id: vehicle.id,
    slug: vehicle.slug,
    name: vehicle.name,
    brand: vehicle.brand,
    category: vehicle.category as AdminVehicle["category"],
    vehicleCode: vehicle.vehicleCode,
    basePrice: vehicle.basePrice,
    thumbnailUrl: vehicle.thumbnailUrl,
    imageUrls: vehicle.imageUrls,
    surchargeRate: vehicle.surchargeRate,
    isVisible: vehicle.isVisible,
    isPopular: vehicle.isPopular,
    isSpotlight: vehicle.isSpotlight,
    slidingDoorOverride: vehicle.slidingDoorOverride,
    advancedSafetyOverride: vehicle.advancedSafetyOverride,
    displayOrder: vehicle.displayOrder,
    tags: vehicle.tags,
    description: vehicle.description,
    scraperRefs: scraperRefs.success ? scraperRefs.data : null,
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
      _count: vehicle._count,
    };
  });
}

export async function getAdminBrands(): Promise<AdminBrand[]> {
  const [brands, counts] = await Promise.all([
    prisma.brand.findMany(),
    prisma.vehicle.groupBy({
      by: ["brand"],
      _count: { id: true },
    }),
  ]);

  const countMap = new Map(counts.map((group) => [group.brand, group._count.id]));
  const enriched: AdminBrand[] = brands.map((brand) => ({
    id: brand.id,
    name: brand.name,
    logoUrl: brand.logoUrl,
    displayOrder: brand.displayOrder,
    isFeatured: brand.isFeatured,
    vehicleCount: countMap.get(brand.name) ?? 0,
  }));
  const signals = new Map(
    enriched.map((brand) => [
      brand.name,
      {
        isFeatured: brand.isFeatured,
        displayOrder: brand.displayOrder,
        vehicleCount: brand.vehicleCount,
      },
    ])
  );
  const compare = makeBrandComparator(signals);
  return enriched.sort((left, right) => compare(left.name, right.name));
}

export { getBrandSignals };

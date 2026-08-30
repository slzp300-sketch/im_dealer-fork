import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashIp, getClientIp } from "@/lib/ip-hash";
import { requireRoleAtLeast } from "@/lib/require-admin";

// 견적 조회 이벤트 = car_click → quote_start 흐름을 한 번에 기록
const quoteViewSchema = z.object({
  sessionId: z.string().min(1).max(64),
  vehicleId: z.string().min(1).max(64),
  slug: z.string().min(1).max(200),
  contractMonths: z.number().int().optional(),
  annualMileage: z.number().int().optional(),
  scenario: z.enum(["보수형", "표준형", "공격형"]).optional(),
});

// ─── POST /api/logs/quote-view ───────────────────────────
// 차량 상세 페이지에서 견적 조건 변경·확인 시 기록
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = quoteViewSchema.parse(body);

    const ip = getClientIp(request);
    const ipHash = hashIp(ip);
    const userAgent = request.headers.get("user-agent") ?? undefined;

    await prisma.explorationLog.create({
      data: {
        sessionId: data.sessionId,
        eventType: "quote_start",
        path: `/cars/${data.slug}`,
        vehicleId: data.vehicleId,
        metadata: {
          contractMonths: data.contractMonths,
          annualMileage: data.annualMileage,
          scenario: data.scenario,
        },
        userAgent,
        ipHash,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "입력값이 올바르지 않습니다.", details: error.flatten() },
        { status: 400 }
      );
    }
    console.error("[POST /api/logs/quote-view]", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

// ─── GET /api/logs/quote-view ────────────────────────────
// 관리자용: 차량별 견적 조회 집계
export async function GET(request: NextRequest) {
  // 관리자용 집계 조회 — staff 이상만 접근 가능 (POST 이벤트 수집은 공개 유지).
  const { error: authError } = await requireRoleAtLeast("staff");
  if (authError) return authError;
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 기본 30일
    const to = searchParams.get("to")
      ? new Date(searchParams.get("to")!)
      : new Date();

    // 차량별 견적 조회수 집계
    const vehicleStats = await prisma.explorationLog.groupBy({
      by: ["vehicleId"],
      where: {
        eventType: "quote_start",
        vehicleId: { not: null },
        createdAt: { gte: from, lte: to },
      },
      _count: { vehicleId: true },
      orderBy: { _count: { vehicleId: "desc" } },
      take: 20,
    });

    // 차량 정보 조인
    const vehicleIds = vehicleStats
      .map((s) => s.vehicleId)
      .filter(Boolean) as string[];

    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: vehicleIds } },
      select: { id: true, name: true, brand: true, slug: true },
    });

    const vehicleMap = Object.fromEntries(vehicles.map((v) => [v.id, v]));

    const result = vehicleStats.map((s) => ({
      vehicleId: s.vehicleId,
      vehicle: s.vehicleId ? vehicleMap[s.vehicleId] : null,
      quoteViewCount: s._count.vehicleId,
    }));

    return NextResponse.json({
      success: true,
      data: {
        topVehicles: result,
        period: { from, to },
        totalQuoteViews: vehicleStats.reduce(
          (sum, s) => sum + s._count.vehicleId,
          0
        ),
      },
    });
  } catch (error) {
    console.error("[GET /api/logs/quote-view]", error);
    return NextResponse.json(
      { error: "견적 조회 통계 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

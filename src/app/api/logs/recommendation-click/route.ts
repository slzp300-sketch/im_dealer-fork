import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

// ─── 스키마 ─────────────────────────────────────────────
const clickSchema = z.object({
  sessionId: z.string().min(1).max(64),
  vehicleId: z.string().min(1).max(64),
  proceedToQuote: z.boolean().optional().default(false),
});

// ─── PATCH /api/logs/recommendation-click ────────────────
// 추천 결과에서 차량 클릭 or 견적 진행 시 로그 업데이트
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const data = clickSchema.parse(body);

    // 해당 세션의 최신 추천 로그에 클릭 기록
    const log = await prisma.recommendationLog.findFirst({
      where: { sessionId: data.sessionId },
      orderBy: { createdAt: "desc" },
    });

    if (!log) {
      return NextResponse.json(
        { error: "해당 세션의 추천 로그를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    await prisma.recommendationLog.update({
      where: { id: log.id },
      data: {
        clickedVehicleId: data.vehicleId,
        clickedAt: new Date(),
        proceedToQuote: data.proceedToQuote,
        vehicleId: data.vehicleId,
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
    console.error("[PATCH /api/logs/recommendation-click]", error);
    return NextResponse.json(
      { error: "클릭 로그 처리 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

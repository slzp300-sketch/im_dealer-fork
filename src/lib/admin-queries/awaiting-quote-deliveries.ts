// 고객 메시지를 기다리는 견적서 목록 (어드민 > 시스템 > 알림톡 큐).
//
// 대기 모드에서는 고객이 카카오 채널로 요청번호를 보내야 견적서가 나간다. 문구를
// 지우고 보내는 고객이 있어 자동 매칭이 실패할 수 있고, 그 건은 여기 남는다.
// 상담사가 상담 내용을 보고 직접 내보낼 수 있게 목록으로 보여준다.

import { prisma } from "../prisma";

export interface AwaitingQuoteDelivery {
  id: string;
  vehicleName: string;
  /** 고객이 대화창에 보내야 하는 번호. 상담 내용과 대조할 때 쓴다. */
  requestCode: string | null;
  customerName: string;
  /** 요청 시각 (ISO) */
  createdAt: string;
}

const AWAITING_LIST_LIMIT = 50;

export async function getAwaitingQuoteDeliveries(): Promise<AwaitingQuoteDelivery[]> {
  const rows = await prisma.quoteDelivery.findMany({
    where: { status: "AWAITING_MESSAGE" },
    orderBy: { createdAt: "desc" },
    take: AWAITING_LIST_LIMIT,
    select: {
      id: true,
      vehicleName: true,
      requestCode: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    vehicleName: row.vehicleName,
    requestCode: row.requestCode,
    customerName: row.user.name,
    createdAt: row.createdAt.toISOString(),
  }));
}

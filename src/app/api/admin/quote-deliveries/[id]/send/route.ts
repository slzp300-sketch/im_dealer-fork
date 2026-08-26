// 대기 중인 견적서를 상담사가 직접 발송한다.
//
// 대기 모드에서는 고객이 카카오 채널로 요청번호를 보내야 자동으로 나간다. 문구를
// 지우고 보내는 고객이 있어 자동 매칭이 실패할 수 있고, 그때 이 경로로 회수한다.
// 발송 조건과 중복 방지는 웹훅과 같은 함수를 쓴다.

import { NextResponse } from "next/server";
import { logAdminAction } from "@/lib/audit";
import { requireAdminLike } from "@/lib/require-admin";
import { dispatchQuoteDeliveryById } from "@/lib/quote-delivery/dispatch";

const FAILURE_MESSAGE: Record<string, string> = {
  not_found: "견적서를 찾을 수 없습니다.",
  already_sent: "이미 발송된 견적서입니다.",
  not_awaiting: "발송 대기 상태가 아닙니다.",
  quote_missing: "원본 견적을 찾을 수 없어 발송할 수 없습니다.",
  enqueue_failed: "발송 적재에 실패했습니다. 고객 연락처를 확인해 주세요.",
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, error } = await requireAdminLike();
  if (error) return error;

  const { id } = await params;

  try {
    const result = await dispatchQuoteDeliveryById(id);
    if (!result.ok) {
      return NextResponse.json(
        { error: FAILURE_MESSAGE[result.reason] ?? "발송할 수 없습니다." },
        { status: 400 }
      );
    }

    await logAdminAction({
      actor: admin,
      action: "QUOTE_DELIVERY_MANUAL_SEND",
      resource: "QuoteDelivery",
      targetId: id,
    });

    return NextResponse.json({ success: true, data: { deliveryId: result.deliveryId } });
  } catch (err) {
    console.error("[POST /api/admin/quote-deliveries/:id/send]", err);
    return NextResponse.json({ error: "발송 중 오류가 발생했습니다." }, { status: 500 });
  }
}

// 대기 중인 견적서를 실제로 발송한다.
//
// 고객이 카카오 채널로 요청번호를 보내면 채널톡 웹훅이 이 함수를 부른다. 견적서와
// 열람 링크는 요청 시점에 이미 만들어 두었으므로 여기서는 알림톡 적재만 하면 된다.
// 어드민의 수동 발송도 같은 경로를 쓴다 — 발송 조건을 한 곳에만 둔다.

import { prisma } from "@/lib/prisma";
import { enqueueAlimtalk } from "@/lib/alimtalk/enqueue";
import {
  buildQuoteDeliveredButtons,
  buildQuoteDeliveredMessage,
} from "@/lib/alimtalk/templates";
import { buildOfficialDeliveryImageData } from "@/lib/quote-delivery/official-image";

export type DispatchResult =
  | { ok: true; deliveryId: string }
  | {
      ok: false;
      reason: "not_found" | "already_sent" | "not_awaiting" | "quote_missing" | "enqueue_failed";
    };

const SAVED_QUOTE_SELECT = {
  id: true,
  vehicleId: true,
  trimId: true,
  contractMonths: true,
  annualMileage: true,
  depositRate: true,
  prepayRate: true,
  contractType: true,
  monthlyPayment: true,
  pricingStatus: true,
  breakdown: true,
  exteriorColorId: true,
  interiorColorId: true,
  createdAt: true,
  expiresAt: true,
} as const;

function quoteLinkUrl(deliveryId: string): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;
  try {
    return `${new URL(configured).origin}/quote/delivery/${encodeURIComponent(deliveryId)}`;
  } catch {
    return null;
  }
}

/** 웹훅 경로 — 고객이 보낸 메시지에서 읽어낸 요청번호로 찾는다. */
export function dispatchQuoteDeliveryByRequestCode(
  requestCode: string
): Promise<DispatchResult> {
  return dispatchQuoteDelivery({ requestCode });
}

/** 어드민 수동 발송 — 고객이 요청번호를 빼고 보낸 건을 상담사가 직접 내보낸다. */
export function dispatchQuoteDeliveryById(deliveryId: string): Promise<DispatchResult> {
  return dispatchQuoteDelivery({ id: deliveryId });
}

async function dispatchQuoteDelivery(
  where: { requestCode: string } | { id: string }
): Promise<DispatchResult> {
  const delivery = await prisma.quoteDelivery.findUnique({
    where,
    select: {
      id: true,
      status: true,
      savedQuoteId: true,
      user: { select: { id: true, name: true, phone: true } },
    },
  });
  if (!delivery) return { ok: false, reason: "not_found" };
  // 같은 메시지가 두 번 들어오거나 고객이 번호를 또 보내는 경우가 있다. 재발송하지 않는다.
  if (delivery.status === "SENT") return { ok: false, reason: "already_sent" };
  if (delivery.status !== "AWAITING_MESSAGE") return { ok: false, reason: "not_awaiting" };
  if (!delivery.savedQuoteId) return { ok: false, reason: "quote_missing" };

  const savedQuote = await prisma.savedQuote.findFirst({
    where: { id: delivery.savedQuoteId, deletedAt: null },
    select: SAVED_QUOTE_SELECT,
  });
  if (!savedQuote) return { ok: false, reason: "quote_missing" };

  const imageResult = await buildOfficialDeliveryImageData(savedQuote);
  if (!imageResult.ok) return { ok: false, reason: "quote_missing" };
  const imageData = imageResult.data;

  const linkUrl = quoteLinkUrl(delivery.id);
  if (!linkUrl) return { ok: false, reason: "enqueue_failed" };

  const scenario = imageData.scenarios[imageData.scenarioType ?? "standard"];
  const queued = await enqueueAlimtalk({
    templateKey: "QUOTE_DELIVERED",
    phone: delivery.user.phone,
    message: buildQuoteDeliveredMessage({
      고객명: delivery.user.name,
      차량명: imageData.vehicleName,
      트림명: imageData.trimName,
      상품유형: imageData.productType,
      계약기간: imageData.contractMonths,
      약정거리: imageData.annualMileage,
      월납입금: scenario.monthlyPayment ?? 0,
      금융사: scenario.bestFinanceCompany,
      링크: linkUrl,
    }),
    buttons: buildQuoteDeliveredButtons(linkUrl),
    userId: delivery.user.id,
    refType: "quote",
    refId: delivery.savedQuoteId,
  });
  if (!queued.ok) return { ok: false, reason: "enqueue_failed" };

  await prisma.quoteDelivery.update({
    where: { id: delivery.id },
    data: { status: "SENT", sentAt: new Date() },
  });

  return { ok: true, deliveryId: delivery.id };
}

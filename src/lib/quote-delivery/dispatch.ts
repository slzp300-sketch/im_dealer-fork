// 대기 중인 견적서를 실제로 발송한다.
//
// 고객이 카카오 채널로 요청번호를 보내면 채널톡 웹훅이 이 함수를 부른다. 견적서와
// 열람 링크는 요청 시점에 이미 만들어 두었으므로 여기서는 알림톡 적재만 하면 된다.
// 어드민의 수동 발송도 같은 경로를 쓴다 — 발송 조건을 한 곳에만 둔다.

import { prisma } from "@/lib/prisma";
import { toE164KR } from "@/lib/phone";
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

// 열람 링크 TTL 과 같은 30일. 그보다 오래된 대기 건은 링크가 만료돼 보내도 죽은
// 링크라, 전화번호 매칭 대상에서 제외하고 어드민 화면에만 남긴다.
const PHONE_MATCH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 전화번호 매칭 — 카카오 상담톡은 chat_extra 등 상담 정보를 채널톡에 넘기지 않아
 * (채널톡 공식 확인), 상담을 연 고객이 "누구인지"로 대기 건을 찾는 수밖에 없다.
 * 같은 고객의 대기 건이 여럿이면 가장 최근 것 하나만 보낸다 — 방금 요청한 건이
 * 고객이 기다리는 그것이고, 이전 건들은 어드민 대기 목록에 그대로 남는다.
 */
export async function dispatchQuoteDeliveryByPhone(
  phone: string
): Promise<DispatchResult> {
  const target = toE164KR(phone);
  if (!target) return { ok: false, reason: "not_found" };

  // User.phone 은 저장 형식이 혼재한다(가입 경로에 따라 "010-…" 또는 "+82 10-…").
  // DB 동등 비교로는 놓치므로 후보를 가져와 정규화해 비교한다 — 대기 건은 소량이다.
  const candidates = await prisma.quoteDelivery.findMany({
    where: {
      status: "AWAITING_MESSAGE",
      createdAt: { gte: new Date(Date.now() - PHONE_MATCH_WINDOW_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { id: true, user: { select: { phone: true } } },
  });

  const matched = candidates.find(
    (candidate) => toE164KR(candidate.user.phone) === target
  );
  if (!matched) return { ok: false, reason: "not_found" };
  return dispatchQuoteDelivery({ id: matched.id });
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
    price: scenario.monthlyPayment ?? null,
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

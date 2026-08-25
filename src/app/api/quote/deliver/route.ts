// 견적서를 회원의 카카오톡으로 전송한다.
// 흐름: 인증 → PNG 생성 → Storage 업로드 → 알림톡 큐 적재 → 이력 기록.
//
// 발송 주체는 아임딜러 카카오 채널(알림톡)이다. 알림톡은 이미지를 첨부할 수 없으므로
// 본문에 견적 요약을, 버튼에 견적서 열람 링크를 담아 보낸다 — 업로드한 PNG 는 그 링크가
// 여는 페이지에서 쓰인다.
//
// 실제 발송은 고정 IP 릴레이(scripts/biztalk-relay)가 큐를 클레임해서 수행하므로
// 여기서 성공은 "적재 완료"까지를 뜻한다. 도달 결과는 AlimtalkMessage 가 추적한다.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireActiveUser } from "@/lib/require-user";
import { renderQuoteImageBuffer } from "@/lib/quote-image/render-quote-image";
import { buildOfficialDeliveryImageData } from "@/lib/quote-delivery/official-image";
import { deleteQuoteImage, uploadQuoteImage } from "@/lib/quote-delivery/store";
import { strictRateLimit, checkRateLimit } from "@/lib/rate-limit";
import { enqueueAlimtalk, type EnqueueAlimtalkResult } from "@/lib/alimtalk/enqueue";
import {
  buildQuoteDeliveredButtons,
  buildQuoteDeliveredMessage,
} from "@/lib/alimtalk/templates";
import {
  notifyAlimtalkEnqueueFailed,
  notifyQuoteDeliverFailed,
} from "@/lib/admin-notification";
import type { PDFQuoteData } from "@/lib/quote-pdf-template";

export const runtime = "nodejs";
export const maxDuration = 30;
// Storage 로 올릴 PNG 상한. 열람 페이지가 감당할 수 있는 크기로 제한한다.
const QUOTE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

const deliveryMetadataSchema = z.object({
  savedQuoteId: z.string().trim().min(1).max(200),
  sessionId: z.string().trim().min(1).max(200),
});

/** 견적 페이지의 자동발송 스위치와 같은 값을 서버에서도 본다. */
function isQuoteAutoSendEnabled(): boolean {
  return process.env.NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND === "true";
}

export async function POST(req: NextRequest) {
  if (!isQuoteAutoSendEnabled()) {
    return NextResponse.json({ error: "사용할 수 없는 기능입니다." }, { status: 404 });
  }

  const limited = await checkRateLimit(req, strictRateLimit);
  if (limited) return limited;

  const { user, error: authError } = await requireActiveUser();
  if (authError) return authError;
  if (!user.supabaseId) {
    return NextResponse.json({ error: "회원 정보를 찾을 수 없습니다." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  const metadataResult = deliveryMetadataSchema.safeParse(body);
  if (!metadataResult.success) {
    return NextResponse.json({ error: "저장된 견적 정보가 필요합니다." }, { status: 400 });
  }

  const savedQuote = await prisma.savedQuote.findFirst({
    where: {
      id: metadataResult.data.savedQuoteId,
      sessionId: metadataResult.data.sessionId,
      userId: user.supabaseId,
      deletedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
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
    },
  });
  if (!savedQuote) {
    return NextResponse.json({ error: "전송할 견적을 확인할 수 없습니다." }, { status: 403 });
  }

  const imageResult = await buildOfficialDeliveryImageData(savedQuote);
  if (!imageResult.ok) {
    return NextResponse.json(
      { error: imageResult.error.error },
      { status: imageResult.error.status }
    );
  }
  const imageData = imageResult.data;

  const appOrigin = getConfiguredAppOrigin();
  if (!appOrigin) {
    return NextResponse.json({ error: "견적서 전송 설정을 확인해 주세요." }, { status: 500 });
  }

  let delivery: { id: string } | null = null;
  let uploadedPath: string | null = null;
  let alimtalkQueued = false;
  try {
    const png = await renderQuoteImageBuffer(imageData);
    if (png.byteLength > QUOTE_IMAGE_MAX_BYTES) {
      return NextResponse.json(
        { error: "견적서 이미지가 전송 가능한 크기를 초과했습니다." },
        { status: 413 }
      );
    }
    const { path } = await uploadQuoteImage({ png });
    uploadedPath = path;

    delivery = await prisma.quoteDelivery.create({
      data: {
        userId: user.id,
        savedQuoteId: savedQuote.id,
        vehicleName: imageData.vehicleName,
        imagePath: path,
        channel: "alimtalk",
        status: "PENDING",
      },
      select: { id: true },
    });

    const queued = await enqueueQuoteAlimtalk({
      user,
      imageData,
      linkUrl: quoteLinkUrl(appOrigin, delivery.id),
      savedQuoteId: savedQuote.id,
    });

    if (!queued.ok) {
      await markDeliveryFailed(delivery.id, queued.reason);
      await removeUploadedQuote(path);
      return NextResponse.json(
        { error: "카카오톡 전송에 실패했습니다. 다시 시도하거나 상담하기를 이용해 주세요." },
        { status: 502 }
      );
    }

    alimtalkQueued = true;
    // 적재 완료 = 발송 요청 완료. 실제 도달 결과는 AlimtalkMessage 쪽에 남는다.
    await markDeliverySent(delivery.id);

    return NextResponse.json({ success: true, data: { deliveryId: delivery.id } });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("[quote/deliver] failed:", error);
    if (delivery) {
      await markDeliveryFailed(delivery.id, error.message.slice(0, 500));
    }
    if (uploadedPath && !alimtalkQueued) await removeUploadedQuote(uploadedPath);
    await notifyQuoteDeliverFailed({
      savedQuoteId: savedQuote.id,
      vehicleName: imageData.vehicleName,
    });
    return NextResponse.json({ error: "견적서 전송에 실패했습니다." }, { status: 500 });
  }
}

function getConfiguredAppOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch (error) {
    if (error instanceof Error) return null;
    throw error;
  }
}

function quoteLinkUrl(appOrigin: string, deliveryId: string): string {
  return `${appOrigin}/quote/delivery/${encodeURIComponent(deliveryId)}`;
}

async function enqueueQuoteAlimtalk(params: {
  user: { id: string; name: string; phone: string | null };
  imageData: PDFQuoteData;
  linkUrl: string;
  savedQuoteId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { user, imageData, linkUrl, savedQuoteId } = params;
  const scenario = imageData.scenarios[imageData.scenarioType ?? "standard"];

  let result: EnqueueAlimtalkResult;
  try {
    result = await enqueueAlimtalk({
      templateKey: "QUOTE_DELIVERED",
      phone: user.phone,
      message: buildQuoteDeliveredMessage({
        고객명: user.name,
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
      userId: user.id,
      refType: "quote",
      refId: savedQuoteId,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("[quote/deliver] 알림톡 적재 실패:", error);
    await notifyAlimtalkEnqueueFailed({
      savedQuoteId,
      vehicleName: imageData.vehicleName,
      reason: "error",
    });
    return { ok: false, reason: "error" };
  }

  // 알림톡이 유일한 발송 경로다 — 적재에 실패하면 고객에게 아무것도 가지 않으므로
  // 설정 누락("disabled")까지 포함해 전부 알린다.
  if (!result.ok) {
    console.warn(`[quote/deliver] 알림톡 적재 건너뜀: ${result.reason}`);
    await notifyAlimtalkEnqueueFailed({
      savedQuoteId,
      vehicleName: imageData.vehicleName,
      reason: result.reason,
    });
    return { ok: false, reason: result.reason };
  }

  return { ok: true };
}

async function markDeliverySent(deliveryId: string): Promise<void> {
  try {
    await prisma.quoteDelivery.update({
      where: { id: deliveryId },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("[quote/deliver] sent status update failed:", error);
    throw error;
  }
}

async function markDeliveryFailed(deliveryId: string, reason: string): Promise<void> {
  try {
    await prisma.quoteDelivery.update({
      where: { id: deliveryId },
      data: { status: "FAILED", failReason: reason },
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("[quote/deliver] failed status update failed:", error);
  }
}

async function removeUploadedQuote(path: string): Promise<void> {
  try {
    await deleteQuoteImage(path);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error("[quote/deliver] uploaded image cleanup failed:", error);
  }
}

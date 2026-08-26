// 채널톡 웹훅 수신 — 고객이 카카오 채널로 보낸 요청번호를 받아 견적서를 발송한다.
//
// 흐름: 고객이 견적서 받기 클릭 → 요청번호가 담긴 문구를 카카오 채널로 전송 →
// 상담이 열림 → 채널톡이 이 라우트를 호출 → 요청번호로 대기 중인 견적서를 찾아 적재.
// 견적서가 나가기 전에 상담이 먼저 열리도록 하려는 구조다.
//
// 인증: 채널톡의 서명 헤더 규격을 확인하기 전까지는 우리가 발급한 토큰을 웹훅 URL 의
// 쿼리로 받아 대조한다(채널톡 콘솔에 등록하는 URL 에 붙인다). 규격을 확인하면 서명
// 검증을 이 앞단에 덧붙인다 — 토큰만으로도 임의 호출은 막힌다.

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { extractQuoteRequestCode } from "@/lib/quote-delivery/request-code";
import { dispatchQuoteDeliveryByRequestCode } from "@/lib/quote-delivery/dispatch";

export const runtime = "nodejs";

function tokenMatches(provided: string | null): boolean {
  const expected = process.env.CHANNEL_TALK_WEBHOOK_TOKEN?.trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 웹훅 본문에서 고객이 보낸 텍스트를 찾는다.
 * 채널톡 문서가 payload 예시를 싣지 않아 필드명을 단정할 수 없다. 알려진 후보를
 * 먼저 보고, 없으면 entity 안의 문자열을 모아 훑는다 — 요청번호만 찾으면 되므로
 * 과하게 읽어도 해가 없다.
 */
export function extractMessageText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const entity = (body as { entity?: unknown }).entity;
  if (!entity || typeof entity !== "object") return "";

  const record = entity as Record<string, unknown>;
  for (const key of ["plainText", "message", "text"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }

  const collected: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || collected.length > 50) return;
    if (typeof value === "string") {
      collected.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) visit(item, depth + 1);
    }
  };
  visit(entity, 0);
  return collected.join("\n");
}

function entityKeys(body: unknown): string[] {
  const entity = (body as { entity?: unknown } | null)?.entity;
  return entity && typeof entity === "object" ? Object.keys(entity) : [];
}

export async function POST(request: NextRequest) {
  const token =
    request.nextUrl.searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!tokenMatches(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid_body" });
  }

  const type = (body as { type?: unknown } | null)?.type;
  if (typeof type === "string" && type !== "Message" && type !== "UserChat") {
    return NextResponse.json({ ok: true, skipped: "other_type" });
  }

  const text = extractMessageText(body);
  const requestCode = extractQuoteRequestCode(text);
  // 채널톡 payload 규격을 확인하기 전이라, 실제로 무엇이 오는지 볼 수 있어야 한다.
  // 고객이 쓴 내용은 남기지 않고 구조만 남긴다.
  console.log(
    `[channel-talk webhook] type=${String(type)} entityKeys=${entityKeys(body).join(",")} textLen=${text.length} code=${requestCode ? "found" : "none"}`
  );

  if (!requestCode) {
    // 요청번호 없는 일반 문의가 대부분이다. 상담은 이미 열렸고 상담사가 이어받는다.
    return NextResponse.json({ ok: true, skipped: "no_request_code" });
  }

  try {
    const result = await dispatchQuoteDeliveryByRequestCode(requestCode);
    if (!result.ok) {
      console.warn(`[channel-talk webhook] ${requestCode} 발송 안 함 — ${result.reason}`);
      return NextResponse.json({ ok: true, skipped: result.reason });
    }
    console.log(`[channel-talk webhook] ${requestCode} 견적서 적재 ${result.deliveryId}`);
    return NextResponse.json({ ok: true, deliveryId: result.deliveryId });
  } catch (error) {
    console.error("[channel-talk webhook]", error);
    // 재시도 폭주를 막으려 200 으로 닫는다. 누락 건은 어드민에서 수동 발송한다.
    return NextResponse.json({ ok: true, skipped: "error" });
  }
}

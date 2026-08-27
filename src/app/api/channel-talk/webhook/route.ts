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
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit";
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

/**
 * 채널톡이 본문과 별개로 실어 주는 상담 extra 문자열을 찾는다. payload 규격이
 * 확정되지 않아 스네이크/카멜 두 표기를 아는 깊이까지 훑는다. 이 필드는 고객
 * 문구와 달리 요청번호만 담기로 한 값이라 본문 텍스트보다 신뢰할 수 있다.
 */
export function extractChatExtraText(body: unknown): string {
  const found: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 4 || found.length > 5 || !value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (
        (key === "chat_extra" || key === "chatExtra") &&
        typeof item === "string" &&
        item.trim()
      ) {
        found.push(item);
      } else if (item && typeof item === "object") {
        visit(item, depth + 1);
      }
    }
  };
  visit(body, 0);
  return found.join("\n");
}

export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, strictRateLimit);
  if (limited) return limited;

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
  const extraText = extractChatExtraText(body);
  const text = extractMessageText(body);
  // 요청번호는 상담 extra 를 먼저 보고, 없으면 고객이 보낸 본문 텍스트를 훑는다.
  const requestCode =
    extractQuoteRequestCode(extraText) ?? extractQuoteRequestCode(text);

  // 채널톡 payload 규격을 확인하기 전이라, 실제로 무엇이 오는지 볼 수 있어야 한다.
  // 어떤 이벤트든 일단 남긴다 — 걸러낸 뒤에 찍으면 예상 밖 이벤트가 조용히 사라진다.
  // 고객이 쓴 내용(요청번호 포함)은 남기지 않고 구조만 남긴다.
  console.log(
    `[channel-talk webhook] type=${String(type)} entityKeys=${entityKeys(body).join(",")} textLen=${text.length} extraLen=${extraText.length} code=${requestCode ? (extraText.includes(requestCode) ? "found:extra" : "found:text") : "none"}`
  );

  // 콘솔에서 고르는 이벤트 이름과 payload 의 type 표기가 다를 수 있어 느슨하게 본다.
  if (typeof type === "string" && !/message|chat/i.test(type)) {
    return NextResponse.json({ ok: true, skipped: "other_type" });
  }

  if (!requestCode) {
    // 요청번호 없는 일반 문의가 대부분이다. 상담은 이미 열렸고 상담사가 이어받는다.
    return NextResponse.json({ ok: true, skipped: "no_request_code" });
  }

  try {
    const result = await dispatchQuoteDeliveryByRequestCode(requestCode);
    if (!result.ok) {
      console.warn(`[channel-talk webhook] 발송 안 함 — ${result.reason}`);
      return NextResponse.json({ ok: true, skipped: result.reason });
    }
    // 요청번호와 deliveryId 는 로그·응답에 실지 않는다. 견적서 링크가 유출되면
    // 아무나 열어볼 수 있으므로, 어드민 발송 이력으로 대신 추적한다.
    console.log(`[channel-talk webhook] 견적서 적재`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[channel-talk webhook]", error);
    // 재시도 폭주를 막으려 200 으로 닫는다. 누락 건은 어드민에서 수동 발송한다.
    return NextResponse.json({ ok: true, skipped: "error" });
  }
}

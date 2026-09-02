// 채널톡 웹훅 수신 — 상담을 연 고객을 식별해 대기 중인 견적서를 발송한다.
//
// 흐름: 고객이 견적서 받기 클릭 → 상담전환톡 발송(대기) → 고객이 버튼 클릭 →
// 상담이 열림 → 채널톡이 이 라우트를 호출 → 대기 중인 견적서를 찾아 적재.
// 견적서가 나가기 전에 상담이 먼저 열리도록 하려는 구조다.
//
// 매칭은 두 단계다. ① 메시지에 요청번호가 있으면 그것으로(가장 확실),
// ② 없으면 personId 로 채널톡 프로필을 조회해 전화번호로 찾는다 — 카카오 상담톡은
// chat_extra 등 상담 정보를 채널톡에 넘기지 않아(채널톡 공식 확인) ②가 기본 경로다.
//
// 인증: 채널톡의 서명 헤더 규격을 확인하기 전까지는 우리가 발급한 토큰을 웹훅 URL 의
// 쿼리로 받아 대조한다(채널톡 콘솔에 등록하는 URL 에 붙인다). 규격을 확인하면 서명
// 검증을 이 앞단에 덧붙인다 — 토큰만으로도 임의 호출은 막힌다.

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, strictRateLimit } from "@/lib/rate-limit";
import { extractQuoteRequestCode } from "@/lib/quote-delivery/request-code";
import {
  dispatchQuoteDeliveryByPhone,
  dispatchQuoteDeliveryByRequestCode,
  hasAwaitingQuoteDelivery,
} from "@/lib/quote-delivery/dispatch";
import {
  fetchChannelTalkChatUserId,
  fetchChannelTalkUserPhone,
  sendChannelTalkChatMessage,
} from "@/lib/channel-talk-open-api";

/**
 * 견적서 적재 직후 그 상담방에만 남기는 안내. 워크플로우 인사말은 견적서와 무관한
 * 일반 문의에도 나가므로 이 문구를 거기에 둘 수 없다 — 발송이 실제로 일어난
 * 상담방에서만 서버가 직접 말한다. 전송 실패는 안내가 안 보일 뿐이라 발송 결과에
 * 영향을 주지 않는다.
 */
const QUOTE_SENT_NOTICE =
  "요청하신 견적서를 카카오톡 알림톡으로 보내드렸어요 📄\n추가로 요청하실 사항이 있으신가요? 이 채팅에 남겨주시면 상담사가 도와드립니다.";

export const runtime = "nodejs";

function tokenMatches(provided: string | null): boolean {
  const expected = process.env.CHANNEL_TALK_WEBHOOK_TOKEN?.trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * 대기 모드에서 전화번호 매칭을 쓸 수 있는지 — deliver 와 같은 규칙을 따른다.
 * 대기 모드는 견적 페이지가 채널톡 유도 흐름을 탈 때(자동발송 OFF)만 의미가 있어,
 * 자동발송이 켜진 조합에선 대기를 보지 않는다(견적서가 이미 나갔다).
 */
function isAwaitMatchingEnabled(): boolean {
  return (
    process.env.QUOTE_DELIVERY_AWAIT_MESSAGE === "true" &&
    process.env.NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND !== "true"
  );
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

  // 안내 메시지를 남길 상담방. 유저챗이 아닌 이벤트(그룹 대화 등)면 null 이라
  // 안내 없이 발송만 된다.
  const userChatId = extractUserChatId(body);

  try {
    if (requestCode) {
      const result = await dispatchQuoteDeliveryByRequestCode(requestCode);
      if (!result.ok) {
        console.warn(`[channel-talk webhook] 발송 안 함 — ${result.reason}`);
        return NextResponse.json({ ok: true, skipped: result.reason });
      }
      // 요청번호와 deliveryId 는 로그·응답에 실지 않는다. 견적서 링크가 유출되면
      // 아무나 열어볼 수 있으므로, 어드민 발송 이력으로 대신 추적한다.
      console.log(`[channel-talk webhook] 견적서 적재`);
      if (userChatId) await sendChannelTalkChatMessage(userChatId, QUOTE_SENT_NOTICE);
      return NextResponse.json({ ok: true });
    }

    // 요청번호가 없으면 전화번호 매칭으로 넘어간다. 카카오 상담톡은 chat_extra 등
    // 상담 정보를 채널톡에 넘기지 않아(채널톡 공식 확인) 요청번호가 자동으로 실려
    // 올 수 없다 — 상담을 연 고객이 "누구인지"(personId → 프로필 전화번호)로 대기
    // 중인 견적서를 찾는다. 일반 문의는 대기 건이 없어 그대로 지나간다.
    //
    // 워크플로우·봇 메시지에는 고객 personId 가 없다. 그런데 상담이 이미 열려 있는
    // 고객이 재진입하면 진입 이벤트가 따로 없어 봇 인사말이 그 상담의 첫 웹훅이
    // 된다 — 이때는 메시지가 속한 유저챗의 주인을 조회해 같은 매칭을 돌린다.
    // 견적서는 어차피 "그 방 고객 본인의" 전화번호로만 매칭되므로, 봇 이벤트로
    // 남의 견적서가 나갈 여지는 없다.
    const personId = extractCustomerPersonId(body);
    if (!personId && !userChatId) {
      return NextResponse.json({ ok: true, skipped: "no_request_code" });
    }

    // 대기 모드가 꺼졌으면 매칭할 대기 건이 만들어지지 않으므로 Open API 조회 없이
    // 닫는다. 대기 건이 있는지는 [status, createdAt] 인덱스로 존지만 싼 값에 본다.
    if (!isAwaitMatchingEnabled()) {
      return NextResponse.json({ ok: true, skipped: "await_disabled" });
    }
    if (!(await hasAwaitingQuoteDelivery())) {
      return NextResponse.json({ ok: true, skipped: "no_awaiting" });
    }

    const customerId =
      personId ?? (userChatId ? await fetchChannelTalkChatUserId(userChatId) : null);
    if (!customerId) {
      return NextResponse.json({ ok: true, skipped: "no_chat_user" });
    }

    const lookup = await fetchChannelTalkUserPhone(customerId);
    // 관측용 — 카카오 경유 고객의 프로필에 번호가 실리는지가 이 설계의 판정 기준이다.
    // 번호 값 자체는 남기지 않는다.
    console.log(
      `[channel-talk webhook] profile ok=${lookup.ok} via=${personId ? "person" : "chat"} phone=${lookup.phone ? "present" : "absent"} profileKeys=${lookup.profileKeys.join(",")}`
    );
    if (!lookup.phone) {
      return NextResponse.json({ ok: true, skipped: "no_phone" });
    }

    const result = await dispatchQuoteDeliveryByPhone(lookup.phone);
    if (!result.ok) {
      // not_found 는 "대기 중인 견적서가 없는 일반 상담"이라 정상 경로다.
      if (result.reason !== "not_found") {
        console.warn(`[channel-talk webhook] 전화번호 매칭 발송 안 함 — ${result.reason}`);
      }
      return NextResponse.json({ ok: true, skipped: result.reason });
    }
    console.log(`[channel-talk webhook] 견적서 적재 (전화번호 매칭)`);
    if (userChatId) await sendChannelTalkChatMessage(userChatId, QUOTE_SENT_NOTICE);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[channel-talk webhook]", error);
    // 재시도 폭주를 막으려 200 으로 닫는다. 누락 건은 어드민에서 수동 발송한다.
    return NextResponse.json({ ok: true, skipped: "error" });
  }
}

/**
 * 봇·워크플로우 메시지가 속한 유저챗 id. 고객 personId 가 없을 때 상담방 주인을
 * 조회하는 데 쓴다. 그룹 대화 등 유저챗이 아닌 방(chatType 이 다름)은 제외한다.
 */
export function extractUserChatId(body: unknown): string | null {
  const entity = (body as { entity?: unknown } | null)?.entity;
  if (!entity || typeof entity !== "object") return null;
  const record = entity as Record<string, unknown>;

  if (typeof record.chatType === "string" && !/^userchat$/i.test(record.chatType)) {
    return null;
  }
  return typeof record.chatId === "string" && record.chatId ? record.chatId : null;
}

/**
 * 웹훅 entity 에서 "고객" 의 person id 를 찾는다. 상담사·봇 메시지에도 웹훅이
 * 오므로 personType 이 user 일 때만 쓴다 — personId 요구와 userId 폴백에 같은
 * 조건을 둔다. 유저챗 생성 이벤트는 personId 대신 userId 를 실을 수 있어 함께 본다.
 */
export function extractCustomerPersonId(body: unknown): string | null {
  const entity = (body as { entity?: unknown } | null)?.entity;
  if (!entity || typeof entity !== "object") return null;
  const record = entity as Record<string, unknown>;

  // userId 폴백에도 같은 조건이 필요하다. 매니저·봇 이벤트(또는 타입이 안 온
  // 이벤트)의 id 로 프로필을 조회해 남의 견적서를 보내는 일이 없도록 한다.
  if (record.personType !== "user") return null;
  if (typeof record.personId === "string" && record.personId) {
    return record.personId;
  }
  if (typeof record.userId === "string" && record.userId) return record.userId;
  return null;
}

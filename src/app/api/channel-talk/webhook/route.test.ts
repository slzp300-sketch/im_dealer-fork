import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  dispatchByPhone: vi.fn(),
  hasAwaiting: vi.fn(),
  fetchPhone: vi.fn(),
  fetchChatUserId: vi.fn(),
  sendChatMessage: vi.fn(),
  addUserTag: vi.fn(),
  openUserChat: vi.fn(),
  checkRateLimit: vi.fn(async (): Promise<NextResponse | null> => null),
}));

vi.mock("@/lib/quote-delivery/dispatch", () => ({
  dispatchQuoteDeliveryByRequestCode: mocks.dispatch,
  dispatchQuoteDeliveryByPhone: mocks.dispatchByPhone,
  hasAwaitingQuoteDelivery: mocks.hasAwaiting,
}));

vi.mock("@/lib/channel-talk-open-api", () => ({
  fetchChannelTalkUserPhone: mocks.fetchPhone,
  fetchChannelTalkChatUserId: mocks.fetchChatUserId,
  sendChannelTalkChatMessage: mocks.sendChatMessage,
  addChannelTalkUserTag: mocks.addUserTag,
  openChannelTalkUserChat: mocks.openUserChat,
}));

// 로컬·CI 에는 Upstash 가 없어 실제 limiter 는 전부 null 이다. 호출 여부와
// 429 전파를 검증하려면 모듈을 갈아끼운다.
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { prefix: "ratelimit:strict" },
  checkRateLimit: mocks.checkRateLimit,
}));

import {
  extractCustomerPersonId,
  extractMessageText,
  extractUserChatId,
  POST,
} from "./route";
import { strictRateLimit } from "@/lib/rate-limit";

const TOKEN = "webhook-token";

function webhookRequest(body: unknown, token: string | null = TOKEN) {
  const url = token
    ? `http://localhost/api/channel-talk/webhook?token=${token}`
    : "http://localhost/api/channel-talk/webhook";
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const messageBody = (plainText: string) => ({
  event: "push",
  type: "Message",
  entity: { plainText },
});

const phoneMatchBody = () => ({
  type: "message",
  entity: { plainText: "안녕하세요", personType: "user", personId: "person-1" },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHANNEL_TALK_WEBHOOK_TOKEN", TOKEN);
  // 전화번호 매칭은 대기 모드가 켜지고 대기 건이 있을 때만 Open API 로 간다.
  // 아래 매칭 테스트들이 그 경로를 지나가기 위한 기본값이다.
  vi.stubEnv("QUOTE_DELIVERY_AWAIT_MESSAGE", "true");
  mocks.hasAwaiting.mockResolvedValue(true);
  mocks.dispatch.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
  mocks.dispatchByPhone.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
  mocks.fetchPhone.mockResolvedValue({ ok: true, phone: "+821012345678", profileKeys: [] });
  mocks.fetchChatUserId.mockResolvedValue("chat-owner-1");
  mocks.sendChatMessage.mockResolvedValue(true);
  mocks.addUserTag.mockResolvedValue(true);
  mocks.openUserChat.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/channel-talk/webhook", () => {
  // 이 라우트를 아무나 때리면 남의 견적서가 나간다.
  it("토큰이 틀리면 401 이고 발송하지 않는다", async () => {
    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD"), "wrong"));

    expect(res.status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rate limit 검사는 strict limiter 로 한다", async () => {
    await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      expect.anything(),
      strictRateLimit
    );
  });

  it("rate limit 에 걸리면 429 로 막고 발송하지 않는다", async () => {
    mocks.checkRateLimit.mockResolvedValueOnce(
      NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 429 })
    );

    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(res.status).toBe(429);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("토큰이 없으면 401", async () => {
    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD"), null));

    expect(res.status).toBe(401);
  });

  it("서버에 토큰이 설정돼 있지 않으면 열어주지 않는다", async () => {
    vi.stubEnv("CHANNEL_TALK_WEBHOOK_TOKEN", "");

    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(res.status).toBe(401);
  });

  it("요청번호를 찾으면 발송한다", async () => {
    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD 견적서 보내주세요")));

    expect(res.status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledWith("AB23CD");
  });

  // 견적서 링크는 deliveryId 만으로 열리므로, 응답에 실리면 토큰 없이 임의
  // 호출로 남의 링크를 확인해볼 여지가 생긴다.
  it("성공 응답에 deliveryId 를 돌려주지 않는다", async () => {
    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(await res.json()).toEqual({ ok: true });
  });

  // 요청번호와 deliveryId 는 로그에도 실지 않는다.
  it("요청번호를 로그에 남기지 않는다", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.dispatch.mockResolvedValue({ ok: false, reason: "already_sent" });

    await POST(webhookRequest(messageBody("요청번호 AB23CD")));
    mocks.dispatch.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
    await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    for (const spy of [logSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(call.join(" ")).not.toContain("AB23CD");
        expect(call.join(" ")).not.toContain("delivery-1");
      }
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // 채널톡이 extra 필드로 요청번호를 실어 주면 본문 문구보다 먼저 본다. 고객이
  // 붙여넣은 본문은 여러 번호·오타가 섞일 수 있어 extra 가 더 신뢰할 수 있다.
  it("chatExtra 필드의 요청번호를 본문 텍스트보다 먼저 본다", async () => {
    const body = {
      type: "Message",
      entity: { chatExtra: "요청번호 AB23CD", plainText: "요청번호 ZX88YV 말고 그거" },
    };

    const res = await POST(webhookRequest(body));

    expect(res.status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledWith("AB23CD");
  });

  it("chat_extra 필드만 있어도 발송한다", async () => {
    const res = await POST(
      webhookRequest({ type: "Message", entity: { chat_extra: "요청번호 AB23CD" } })
    );

    expect(res.status).toBe(200);
    expect(mocks.dispatch).toHaveBeenCalledWith("AB23CD");
  });

  // 요청번호도 personId 도 없는 이벤트 — 아무것도 하지 않는다.
  it("요청번호도 고객 식별자도 없으면 아무것도 보내지 않는다", async () => {
    const res = await POST(webhookRequest(messageBody("안녕하세요 상담 가능한가요")));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "no_request_code" });
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(mocks.dispatchByPhone).not.toHaveBeenCalled();
  });

  // 카카오 상담톡은 chat_extra 를 채널톡에 넘기지 않는다(공식 확인). 그래서
  // 요청번호가 없으면 상담을 연 고객의 전화번호로 대기 건을 찾는 것이 기본 경로다.
  it("요청번호가 없으면 personId 로 전화번호를 조회해 매칭 발송한다", async () => {
    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(res.status).toBe(200);
    expect(mocks.fetchPhone).toHaveBeenCalledWith("person-1");
    expect(mocks.dispatchByPhone).toHaveBeenCalledWith("+821012345678");
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  // Open API 조회는 비싸다. 대기 모드가 꺼졌으면 매칭할 대기 건이 애초에
  // 만들어지지 않으므로, 프로필 조회 없이 닫는다.
  it("대기 모드가 꺼졌으면 Open API 조회 없이 await_disabled 로 지나간다", async () => {
    vi.stubEnv("QUOTE_DELIVERY_AWAIT_MESSAGE", "false");

    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(await res.json()).toMatchObject({ skipped: "await_disabled" });
    expect(mocks.hasAwaiting).not.toHaveBeenCalled();
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
  });

  // deliver 와 같은 규칙 — 자동발송이 켜진 조합에선 대기 모드를 보지 않는다.
  it("자동발송이 켜진 조합에선 대기 모드를 무시한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "true");

    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(await res.json()).toMatchObject({ skipped: "await_disabled" });
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
  });

  // 대기 건이 하나도 없으면 일반 상담이다. 프로필 조회를 아끼러 존지만 본다.
  it("대기 건이 없으면 Open API 조회 없이 no_awaiting 으로 지나간다", async () => {
    mocks.hasAwaiting.mockResolvedValue(false);

    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(await res.json()).toMatchObject({ skipped: "no_awaiting" });
    expect(mocks.hasAwaiting).toHaveBeenCalled();
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
  });

  // 상담사·봇이 보낸 메시지에도 웹훅이 온다. 그 personId 로 조회하면 안 된다.
  it("고객이 아닌 발신(personType!=user)은 전화번호 매칭을 하지 않는다", async () => {
    const body = {
      type: "message",
      entity: { plainText: "무엇을 도와드릴까요", personType: "manager", personId: "mgr-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(res.status).toBe(200);
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
    expect(mocks.dispatchByPhone).not.toHaveBeenCalled();
  });

  // 상담이 이미 열려 있는 고객이 재진입하면 진입 이벤트가 없어 워크플로우 인사말이
  // 그 상담의 첫 웹훅이 된다. 이때는 유저챗 주인을 조회해 같은 매칭을 돌린다 —
  // 안 그러면 고객이 뭔가 입력할 때까지 견적서가 밀린다.
  it("봇 메시지는 유저챗 주인을 조회해 매칭 발송한다", async () => {
    const body = {
      type: "message",
      entity: {
        plainText: "무엇을 도와드릴까요",
        personType: "bot",
        personId: "bot-1",
        chatType: "userChat",
        chatId: "chat-1",
      },
    };

    const res = await POST(webhookRequest(body));

    expect(res.status).toBe(200);
    expect(mocks.fetchChatUserId).toHaveBeenCalledWith("chat-1");
    expect(mocks.fetchPhone).toHaveBeenCalledWith("chat-owner-1");
    expect(mocks.dispatchByPhone).toHaveBeenCalledWith("+821012345678");
  });

  it("유저챗 주인 조회가 실패하면 no_chat_user 로 지나간다", async () => {
    mocks.fetchChatUserId.mockResolvedValue(null);
    const body = {
      type: "message",
      entity: { personType: "bot", chatType: "userChat", chatId: "chat-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(await res.json()).toMatchObject({ skipped: "no_chat_user" });
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
  });

  // Open API 호출을 아끼는 가드는 유저챗 주인 조회에도 똑같이 걸린다.
  it("대기 건이 없으면 유저챗 주인 조회도 하지 않는다", async () => {
    mocks.hasAwaiting.mockResolvedValue(false);
    const body = {
      type: "message",
      entity: { personType: "bot", chatType: "userChat", chatId: "chat-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(await res.json()).toMatchObject({ skipped: "no_awaiting" });
    expect(mocks.fetchChatUserId).not.toHaveBeenCalled();
  });

  // 고객 personId 가 있으면 유저챗 조회는 불필요한 API 호출이다.
  it("고객 메시지는 유저챗 주인 조회 없이 personId 로 간다", async () => {
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.fetchChatUserId).not.toHaveBeenCalled();
    expect(mocks.fetchPhone).toHaveBeenCalledWith("person-1");
  });

  // 워크플로우 인사말은 모든 상담에 나가므로 "보내드렸어요" 문구를 거기에 둘 수
  // 없다 — 발송이 실제로 일어난 상담방에만 서버가 안내를 남긴다.
  it("적재에 성공하면 그 상담방에 안내 메시지를 남긴다", async () => {
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(res.status).toBe(200);
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.stringContaining("견적서")
    );
  });

  it("요청번호 발송에 성공해도 상담방 안내를 남긴다", async () => {
    const body = {
      type: "Message",
      entity: { plainText: "요청번호 AB23CD", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.dispatch).toHaveBeenCalledWith("AB23CD");
    expect(mocks.sendChatMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.stringContaining("견적서")
    );
  });

  it("발송이 일어나지 않으면 안내 메시지도 남기지 않는다", async () => {
    mocks.dispatchByPhone.mockResolvedValue({ ok: false, reason: "not_found" });
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  // 견적서 진입 고객에게 「유입/견적서」 태그를 붙여 워크플로우 인사말을 생략시킨다.
  it("전화번호 매칭 적재 성공 시 고객에게 유입 태그를 부여한다", async () => {
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.addUserTag).toHaveBeenCalledWith("person-1", "유입/견적서");
  });

  it("요청번호 적재 성공 시 유저챗 주인에게 유입 태그를 부여한다", async () => {
    const body = {
      type: "Message",
      entity: { plainText: "요청번호 AB23CD", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.fetchChatUserId).toHaveBeenCalledWith("chat-1");
    expect(mocks.addUserTag).toHaveBeenCalledWith("chat-owner-1", "유입/견적서");
  });

  it("견적서가 발송되지 않으면 태그도 부여하지 않는다", async () => {
    mocks.dispatchByPhone.mockResolvedValue({ ok: false, reason: "not_found" });
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.addUserTag).not.toHaveBeenCalled();
  });

  // 견적서 상담을 수신함에 올리는 것은 플래그로만 켠다 — 기본(꺼짐)에선 상담을
  // 열지 않아 봇 관망 정책·워크플로우와 충돌하지 않는다.
  it("플래그가 꺼져 있으면 상담을 열지 않는다(기본)", async () => {
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.openUserChat).not.toHaveBeenCalled();
  });

  it("플래그가 켜지면 전화번호 매칭 적재 성공 시 그 상담을 수신함에 연다", async () => {
    vi.stubEnv("QUOTE_CONSULT_OPEN_INBOX", "true");
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.openUserChat).toHaveBeenCalledWith("chat-1");
  });

  it("플래그가 켜지면 요청번호 적재 성공 시에도 상담을 연다", async () => {
    vi.stubEnv("QUOTE_CONSULT_OPEN_INBOX", "true");
    const body = {
      type: "Message",
      entity: { plainText: "요청번호 AB23CD", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.openUserChat).toHaveBeenCalledWith("chat-1");
  });

  it("플래그가 켜져도 발송이 일어나지 않으면 상담을 열지 않는다", async () => {
    vi.stubEnv("QUOTE_CONSULT_OPEN_INBOX", "true");
    mocks.dispatchByPhone.mockResolvedValue({ ok: false, reason: "not_found" });
    const body = {
      type: "message",
      entity: { personType: "user", personId: "person-1", chatId: "chat-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.openUserChat).not.toHaveBeenCalled();
  });

  it("상담방 id 가 없으면 안내 없이 발송만 한다", async () => {
    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(res.status).toBe(200);
    expect(mocks.dispatchByPhone).toHaveBeenCalled();
    expect(mocks.sendChatMessage).not.toHaveBeenCalled();
  });

  // 카카오 경유 고객은 프로필에 번호가 없을 수 있다 — 이 설계의 판정 지점이라
  // skipped 사유를 구분해 남긴다.
  it("프로필에 전화번호가 없으면 no_phone 으로 지나간다", async () => {
    mocks.fetchPhone.mockResolvedValue({ ok: true, phone: null, profileKeys: ["name"] });

    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(await res.json()).toMatchObject({ skipped: "no_phone" });
    expect(mocks.dispatchByPhone).not.toHaveBeenCalled();
  });

  // 대기 중인 견적서가 없는 일반 상담 — 정상 경로라 경고 없이 지나간다.
  it("매칭되는 대기 건이 없으면 not_found 로 지나간다", async () => {
    mocks.dispatchByPhone.mockResolvedValue({ ok: false, reason: "not_found" });

    const res = await POST(webhookRequest(phoneMatchBody()));

    expect(await res.json()).toMatchObject({ skipped: "not_found" });
  });

  // 요청번호가 있으면 전화번호 조회 없이 그것으로 발송한다 — API 호출을 아낀다.
  it("요청번호가 있으면 전화번호 조회를 하지 않는다", async () => {
    const body = {
      type: "message",
      entity: { plainText: "요청번호 AB23CD", personType: "user", personId: "person-1" },
    };

    await POST(webhookRequest(body));

    expect(mocks.dispatch).toHaveBeenCalledWith("AB23CD");
    expect(mocks.fetchPhone).not.toHaveBeenCalled();
  });

  it("이미 보낸 건은 다시 보내지 않는다", async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, reason: "already_sent" });

    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: "already_sent" });
  });

  // 500 을 돌려주면 채널톡이 재시도를 반복한다. 누락은 어드민 수동 발송으로 회수한다.
  it("발송 중 오류가 나도 200 으로 닫는다", async () => {
    mocks.dispatch.mockRejectedValue(new Error("boom"));

    const res = await POST(webhookRequest(messageBody("요청번호 AB23CD")));

    expect(res.status).toBe(200);
  });

  it("Message·UserChat 이 아닌 이벤트는 무시한다", async () => {
    const res = await POST(
      webhookRequest({ type: "User", entity: { plainText: "요청번호 AB23CD" } })
    );

    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(await res.json()).toMatchObject({ skipped: "other_type" });
  });
});

describe("extractMessageText", () => {
  it("plainText 를 먼저 본다", () => {
    expect(extractMessageText({ entity: { plainText: "안녕" } })).toBe("안녕");
  });

  // 채널톡 문서에 payload 예시가 없어 필드명을 단정할 수 없다.
  it("알려진 필드가 없으면 entity 안의 문자열을 모아 훑는다", () => {
    const body = { entity: { blocks: [{ type: "text", value: "요청번호 AB23CD" }] } };

    expect(extractMessageText(body)).toContain("요청번호 AB23CD");
  });

  it("entity 가 없으면 빈 문자열", () => {
    expect(extractMessageText({ type: "Message" })).toBe("");
    expect(extractMessageText(null)).toBe("");
  });
});

describe("extractUserChatId", () => {
  it("유저챗 메시지의 chatId 를 돌려준다", () => {
    expect(
      extractUserChatId({ entity: { chatType: "userChat", chatId: "chat-1" } })
    ).toBe("chat-1");
    expect(extractUserChatId({ entity: { chatId: "chat-1" } })).toBe("chat-1");
  });

  // 그룹 대화 등 유저챗이 아닌 방의 봇 메시지로 견적서를 보내면 안 된다.
  it("유저챗이 아닌 방은 돌려주지 않는다", () => {
    expect(
      extractUserChatId({ entity: { chatType: "group", chatId: "group-1" } })
    ).toBeNull();
    expect(extractUserChatId({ entity: {} })).toBeNull();
    expect(extractUserChatId(null)).toBeNull();
  });
});

describe("extractCustomerPersonId", () => {
  it("고객 메시지의 personId 를 돌려준다", () => {
    expect(
      extractCustomerPersonId({ entity: { personType: "user", personId: "person-1" } })
    ).toBe("person-1");
  });

  // 유저챗 생성 이벤트는 personId 대신 userId 를 실을 수 있다.
  it("personId 가 없으면 고객의 userId 로 폴백한다", () => {
    expect(
      extractCustomerPersonId({ entity: { personType: "user", userId: "user-1" } })
    ).toBe("user-1");
  });

  // 상담사·봇(또는 타입이 안 온) 이벤트의 id 로 프로필을 조회해 남의 견적서를
  // 보내는 일이 없도록 한다 — userId 폴백에도 personType 이 user 여야 한다.
  it("userId 는 personType 이 user 일 때만 돌려준다", () => {
    expect(
      extractCustomerPersonId({ entity: { personType: "manager", userId: "mgr-1" } })
    ).toBeNull();
    expect(extractCustomerPersonId({ entity: { personType: "bot", userId: "bot-1" } })).toBeNull();
    expect(extractCustomerPersonId({ entity: { userId: "user-1" } })).toBeNull();
  });

  it("personType 이 user 가 아니면 personId 도 돌려주지 않는다", () => {
    expect(
      extractCustomerPersonId({ entity: { personType: "manager", personId: "mgr-1" } })
    ).toBeNull();
    expect(extractCustomerPersonId({ entity: { personId: "person-1" } })).toBeNull();
  });
});

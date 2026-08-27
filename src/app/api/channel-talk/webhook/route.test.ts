import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  dispatchByPhone: vi.fn(),
  fetchPhone: vi.fn(),
  checkRateLimit: vi.fn(async (): Promise<NextResponse | null> => null),
}));

vi.mock("@/lib/quote-delivery/dispatch", () => ({
  dispatchQuoteDeliveryByRequestCode: mocks.dispatch,
  dispatchQuoteDeliveryByPhone: mocks.dispatchByPhone,
}));

vi.mock("@/lib/channel-talk-open-api", () => ({
  fetchChannelTalkUserPhone: mocks.fetchPhone,
}));

// 로컬·CI 에는 Upstash 가 없어 실제 limiter 는 전부 null 이다. 호출 여부와
// 429 전파를 검증하려면 모듈을 갈아끼운다.
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: { prefix: "ratelimit:strict" },
  checkRateLimit: mocks.checkRateLimit,
}));

import { extractMessageText, POST } from "./route";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CHANNEL_TALK_WEBHOOK_TOKEN", TOKEN);
  mocks.dispatch.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
  mocks.dispatchByPhone.mockResolvedValue({ ok: true, deliveryId: "delivery-1" });
  mocks.fetchPhone.mockResolvedValue({ ok: true, phone: "+821012345678", profileKeys: [] });
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
    const body = {
      type: "message",
      entity: { plainText: "안녕하세요", personType: "user", personId: "person-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(res.status).toBe(200);
    expect(mocks.fetchPhone).toHaveBeenCalledWith("person-1");
    expect(mocks.dispatchByPhone).toHaveBeenCalledWith("+821012345678");
    expect(mocks.dispatch).not.toHaveBeenCalled();
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

  // 카카오 경유 고객은 프로필에 번호가 없을 수 있다 — 이 설계의 판정 지점이라
  // skipped 사유를 구분해 남긴다.
  it("프로필에 전화번호가 없으면 no_phone 으로 지나간다", async () => {
    mocks.fetchPhone.mockResolvedValue({ ok: true, phone: null, profileKeys: ["name"] });
    const body = {
      type: "message",
      entity: { plainText: "안녕하세요", personType: "user", personId: "person-1" },
    };

    const res = await POST(webhookRequest(body));

    expect(await res.json()).toMatchObject({ skipped: "no_phone" });
    expect(mocks.dispatchByPhone).not.toHaveBeenCalled();
  });

  // 대기 중인 견적서가 없는 일반 상담 — 정상 경로라 경고 없이 지나간다.
  it("매칭되는 대기 건이 없으면 not_found 로 지나간다", async () => {
    mocks.dispatchByPhone.mockResolvedValue({ ok: false, reason: "not_found" });
    const body = {
      type: "message",
      entity: { plainText: "안녕하세요", personType: "user", personId: "person-1" },
    };

    const res = await POST(webhookRequest(body));

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

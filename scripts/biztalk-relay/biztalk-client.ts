// 비즈톡 BGMS API 클라이언트. 이 프로세스가 도는 서버의 IPv4 가 비즈톡에 등록되어
// 있어야 호출이 통과한다(미등록 시 B199 / UnregistedIpAddressException).
// 토큰도 발급받은 IP 에서만 유효하므로 캐시는 프로세스 단위로 둔다.

import type { AlimtalkButton } from "../../src/lib/alimtalk/types";

const HOST = (process.env.BIZTALK_API_HOST ?? "https://www.biztalk-api.com").replace(/\/+$/, "");
// 토큰 유효시간 24시간, 요청은 12시간마다 권장(매뉴얼 2.1). 만료 30분 전에 갱신한다.
const TOKEN_EXPIRE_MINUTES = 1440;
const TOKEN_RENEW_MARGIN_MS = 30 * 60 * 1000;
// 매뉴얼 권장: client timeout 100초
const REQUEST_TIMEOUT_MS = 100_000;

export interface SendResult {
  responseCode: string;
  msg?: string;
}

export interface PollResultItem {
  msgIdx?: string;
  resultCode?: string;
  sendType?: string;
  uid?: string;
}

export interface PollResult {
  pk: string | null;
  responseCode: string;
  items: PollResultItem[];
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function request(path: string, init: RequestInit): Promise<unknown> {
  const res = await fetch(`${HOST}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`비즈톡 ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`비즈톡 ${path} 응답이 JSON 이 아닙니다: ${text.slice(0, 300)}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** expireDate 는 "YYYYMMDDhhmmss" (KST). 파싱 실패 시 12시간 뒤로 잡는다. */
function parseExpireDate(raw: string | undefined): number {
  const fallback = Date.now() + 12 * 60 * 60 * 1000;
  if (!raw || !/^\d{14}$/.test(raw)) return fallback;
  const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+09:00`;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? fallback : ms;
}

export async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - TOKEN_RENEW_MARGIN_MS) {
    return cachedToken.value;
  }

  const body = await request("/v2/auth/getToken", {
    method: "POST",
    body: JSON.stringify({
      bsid: process.env.BIZTALK_BSID,
      passwd: process.env.BIZTALK_PASSWD,
      expire: TOKEN_EXPIRE_MINUTES,
    }),
  });
  const parsed = asRecord(body);
  const token = asString(parsed.token);
  if (parsed.responseCode !== "1000" || !token) {
    throw new Error(`토큰 발급 실패 ${parsed.responseCode}: ${asString(parsed.msg) ?? ""}`);
  }

  cachedToken = { value: token, expiresAt: parseExpireDate(asString(parsed.expireDate)) };
  return token;
}

/** 토큰 만료·무효(B199) 시 한 번만 재발급해서 재시도하기 위해 캐시를 버린다. */
export function invalidateToken(): void {
  cachedToken = null;
}

export interface SendAlimTalkInput {
  msgIdx: string;
  templateCode: string;
  recipient: string;
  message: string;
  buttons: AlimtalkButton[];
  /** 본문에 금액 표기가 있는 템플릿만. 통화는 여기서 KRW 로 고정해 붙인다. */
  price?: number;
}

export async function sendAlimTalk(input: SendAlimTalkInput): Promise<SendResult> {
  // 테스트 모드에서는 사전 등록된 테스트 번호(최대 3개)로만 나간다. 성공 시 과금은 동일하다.
  const path =
    process.env.BIZTALK_TEST_MODE === "true" ? "/v2/kko/sendAlimTalkTF" : "/v2/kko/sendAlimTalk";

  const send = async () => {
    const token = await getToken();
    return asRecord(
      await request(path, {
        method: "POST",
        headers: { "bt-token": token },
        body: JSON.stringify({
          msgIdx: input.msgIdx,
          countryCode: "82",
          resMethod: "PUSH",
          senderKey: process.env.BIZTALK_SENDER_KEY,
          tmpltCode: input.templateCode,
          message: input.message,
          recipient: input.recipient,
          ...(input.buttons.length ? { attach: { button: input.buttons } } : {}),
          // 본문에 금액이 있으면 카카오가 정산성 메시지로 식별할 수 있게 함께 보낸다.
          ...(typeof input.price === "number" && input.price > 0
            ? { price: input.price, currencyType: "KRW" }
            : {}),
        }),
      })
    );
  };

  let parsed = await send();
  if (parsed.responseCode === "B199") {
    // 토큰 만료/무효일 수 있다. IP 미등록이면 재발급해도 같은 코드가 나오므로 1회만 시도한다.
    invalidateToken();
    parsed = await send();
  }

  return {
    responseCode: asString(parsed.responseCode) ?? "UNKNOWN",
    msg: asString(parsed.msg),
  };
}

export async function getResultPoll(): Promise<PollResult> {
  const token = await getToken();
  const parsed = asRecord(
    await request("/v2/kko/getResultPoll", { method: "GET", headers: { "bt-token": token } })
  );
  const raw = Array.isArray(parsed.response) ? parsed.response : [];

  return {
    pk: asString(parsed.pk) ?? null,
    responseCode: asString(parsed.responseCode) ?? "UNKNOWN",
    items: raw.map((item) => {
      const r = asRecord(item);
      return {
        msgIdx: asString(r.msgIdx),
        resultCode: asString(r.resultCode),
        sendType: asString(r.sendType),
        uid: asString(r.uid),
      };
    }),
  };
}

/** ack 하지 않으면 같은 결과가 다음 폴링에 다시 내려온다. 앱 기록이 끝난 뒤에만 호출할 것. */
export async function ackResultPoll(pk: string): Promise<void> {
  const token = await getToken();
  await request("/v2/kko/ackResultPoll", {
    method: "POST",
    headers: { "bt-token": token },
    body: JSON.stringify({ pk }),
  });
}

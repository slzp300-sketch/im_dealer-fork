// 채널톡 Open API — 상담 고객 프로필 조회.
//
// 카카오 상담톡에서 채널톡으로 넘어오는 상담 정보(chat_extra 등)는 없고 "동일
// 고객인지"만 인식된다(채널톡 공식 확인, 2026-08-27). 그래서 견적서 자동 발송은
// 웹훅이 준 personId 로 이 API 를 호출해 전화번호를 얻고, 그 번호로 대기 중인
// 견적서를 찾는 방식으로 잇는다.
//
// 인증 키는 채널톡 콘솔 `설정 > 보안 및 개발 > API` 에서 발급한 것이다.

const API_HOST = "https://api.channel.io";
const REQUEST_TIMEOUT_MS = 10_000;

function credentials(): { key: string; secret: string } | null {
  const key = process.env.CHANNEL_TALK_ACCESS_KEY?.trim();
  const secret = process.env.CHANNEL_TALK_ACCESS_SECRET?.trim();
  return key && secret ? { key, secret } : null;
}

/** 프로필에서 전화번호로 볼 수 있는 값을 훑는다. 필드명이 문서에 확정돼 있지 않다. */
function pickPhone(user: Record<string, unknown>): string | null {
  const profile = user.profile;
  const sources: unknown[] = [
    (profile as Record<string, unknown> | undefined)?.mobileNumber,
    (profile as Record<string, unknown> | undefined)?.phoneNumber,
    (profile as Record<string, unknown> | undefined)?.phone,
    user.mobileNumber,
  ];
  for (const value of sources) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

export interface ChannelTalkUserLookup {
  ok: boolean;
  /** 조회는 됐지만 번호가 비어 있을 수 있다 — 카카오 경유 고객은 번호가 없을 가능성이 있다. */
  phone: string | null;
  /** 관측용. 프로필에 어떤 키가 있는지 — 값은 담지 않는다. */
  profileKeys: string[];
}

/**
 * 유저챗의 고객 userId 조회. 워크플로우·봇 메시지 이벤트에는 고객 personId 가
 * 없어서(발신자가 봇이다), 그 상담방의 주인이 누구인지를 이걸로 알아낸다.
 * 상담이 이미 열려 있는 고객은 재진입 시 진입 이벤트가 없어 봇 인사말이
 * 첫 웹훅이 되는데, 이 조회가 없으면 고객이 뭔가 입력할 때까지 발송이 밀린다.
 */
export async function fetchChannelTalkChatUserId(
  userChatId: string
): Promise<string | null> {
  const creds = credentials();
  if (!creds) {
    console.warn("[channel-talk api] 액세스 키 미설정 — 유저챗 조회를 건너뜀");
    return null;
  }

  try {
    const response = await fetch(
      `${API_HOST}/open/v5/user-chats/${encodeURIComponent(userChatId)}`,
      {
        headers: {
          "x-access-key": creds.key,
          "x-access-secret": creds.secret,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      console.warn(`[channel-talk api] 유저챗 조회 HTTP ${response.status}`);
      return null;
    }

    const body = (await response.json()) as {
      userChat?: { userId?: unknown };
      user?: { id?: unknown };
    };
    const userId = body.userChat?.userId ?? body.user?.id;
    return typeof userId === "string" && userId ? userId : null;
  } catch (error) {
    console.warn(
      `[channel-talk api] 유저챗 조회 실패: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

/**
 * 유저챗에 봇 메시지를 넣는다. 견적서 적재 직후 "보내드렸어요" 안내를 그 상담방에만
 * 남기는 용도다 — 워크플로우 인사말은 모든 상담에 나가므로 견적서 문구를 거기에
 * 섞을 수 없다(견적서와 무관한 일반 문의도 같은 인사말을 받는다).
 * 실패해도 견적서 발송 자체에는 영향이 없으므로 경고만 남기고 false 를 돌려준다.
 */
export async function sendChannelTalkChatMessage(
  userChatId: string,
  text: string
): Promise<boolean> {
  const creds = credentials();
  if (!creds) {
    console.warn("[channel-talk api] 액세스 키 미설정 — 상담방 안내 메시지를 건너뜀");
    return false;
  }

  // botName 이 없으면 채널톡이 기본 봇 이름으로 남긴다. 콘솔에 만든 봇 이름을
  // 쓰고 싶으면 env 로 지정한다.
  const botName = process.env.CHANNEL_TALK_BOT_NAME?.trim();
  const query = botName ? `?botName=${encodeURIComponent(botName)}` : "";

  try {
    const response = await fetch(
      `${API_HOST}/open/v5/user-chats/${encodeURIComponent(userChatId)}/messages${query}`,
      {
        method: "POST",
        headers: {
          "x-access-key": creds.key,
          "x-access-secret": creds.secret,
          "content-type": "application/json",
        },
        body: JSON.stringify({ blocks: [{ type: "text", value: text }] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      console.warn(`[channel-talk api] 상담방 메시지 HTTP ${response.status}`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `[channel-talk api] 상담방 메시지 실패: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

export async function fetchChannelTalkUserPhone(
  personId: string
): Promise<ChannelTalkUserLookup> {
  const creds = credentials();
  if (!creds) {
    console.warn("[channel-talk api] 액세스 키 미설정 — 전화번호 매칭을 건너뜀");
    return { ok: false, phone: null, profileKeys: [] };
  }

  try {
    const response = await fetch(
      `${API_HOST}/open/v5/users/${encodeURIComponent(personId)}`,
      {
        headers: {
          "x-access-key": creds.key,
          "x-access-secret": creds.secret,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      console.warn(`[channel-talk api] 사용자 조회 HTTP ${response.status}`);
      return { ok: false, phone: null, profileKeys: [] };
    }

    const body = (await response.json()) as { user?: Record<string, unknown> };
    const user = body.user;
    if (!user || typeof user !== "object") {
      return { ok: false, phone: null, profileKeys: [] };
    }

    const profile = user.profile;
    const profileKeys =
      profile && typeof profile === "object" ? Object.keys(profile) : [];
    return { ok: true, phone: pickPhone(user), profileKeys };
  } catch (error) {
    console.warn(
      `[channel-talk api] 사용자 조회 실패: ${error instanceof Error ? error.message : String(error)}`
    );
    return { ok: false, phone: null, profileKeys: [] };
  }
}

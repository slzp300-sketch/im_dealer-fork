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

/**
 * 실패 응답 본문을 진단용으로 짧게 뽑는다. 상태코드만으로는 원인을 알 수 없어(예:
 * 안내 메시지의 422 — 이미 열린 상담이라 거부됐는지 등) 이유 문구를 로그에 남긴다.
 * 본문 읽기 자체가 실패해도 로깅이 깨지지 않도록 삼키고, 길이도 제한한다.
 */
async function errorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    return text ? ` body=${text.slice(0, 300)}` : "";
  } catch {
    return "";
  }
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
      console.warn(
        `[channel-talk api] 상담방 메시지 HTTP ${response.status}${await errorBody(response)}`
      );
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

/**
 * 고객(user)에게 태그를 하나 부여한다. 견적서 흐름으로 진입한 고객을 표시해,
 * 카카오 워크플로우가 그 고객에게는 인사말을 생략하도록 하기 위한 것이다
 * (해제는 채널톡 워크플로우가 담당 — 채널톡 공식 안내, 2026-09-02).
 *
 * 태그는 유저 수정(PATCH /open/v5/users/{id})의 body `tags` 로 설정하며 목록을
 * 통째로 교체한다(채널톡 공식 n8n 커넥터로 확인, 2026-09-03 — 최대 20개). 그래서
 * 기존 태그를 먼저 읽어 병합한다. 실패해도 견적서 발송에는 영향이 없으므로(태그가
 * 늦으면 인사말이 한 번 더 보일 뿐) 경고만 남기고 false 를 준다.
 */
export async function addChannelTalkUserTag(
  userId: string,
  tag: string
): Promise<boolean> {
  const creds = credentials();
  if (!creds) {
    console.warn("[channel-talk api] 액세스 키 미설정 — 태그 부여를 건너뜀");
    return false;
  }
  const authHeaders = { "x-access-key": creds.key, "x-access-secret": creds.secret };

  try {
    // 1) 기존 태그를 읽어 병합한다(교체 API 라 덮어쓰지 않도록).
    const getRes = await fetch(
      `${API_HOST}/open/v5/users/${encodeURIComponent(userId)}`,
      { headers: authHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
    );
    if (!getRes.ok) {
      console.warn(`[channel-talk api] 태그용 사용자 조회 HTTP ${getRes.status}`);
      return false;
    }
    const body = (await getRes.json()) as { user?: { tags?: unknown } };
    const current = Array.isArray(body.user?.tags)
      ? body.user!.tags!.filter((t): t is string => typeof t === "string")
      : [];
    if (current.includes(tag)) return true; // 이미 있으면 호출을 아낀다.

    // 2) 유저 수정으로 태그 목록을 통째로 설정한다(교체 API 라 병합한 값을 보낸다).
    const patchRes = await fetch(
      `${API_HOST}/open/v5/users/${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ tags: [...current, tag] }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!patchRes.ok) {
      console.warn(
        `[channel-talk api] 태그 부여 HTTP ${patchRes.status}${await errorBody(patchRes)}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `[channel-talk api] 태그 부여 실패: ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * 유저챗을 "열린 상담"으로 전환한다(PUT /open/v5/user-chats/{id}/open). 봇/워크플로우가
 * 자동응대 중인 상담은 데스크 수신함에 뜨지 않아 상담사가 확인·응대할 수 없다 —
 * 견적서를 받은 고객(구매 의도 리드)의 상담을 수신함에 올려, 상담사가 먼저 볼 수
 * 있게 하는 용도다. 특정 상담사 배정 없이 "열기"만 해 수신함에 노출시킨다.
 *
 * 실패해도 견적서 발송에는 영향이 없으므로(수신함 노출이 안 될 뿐) 경고만 남기고
 * false 를 준다. 호출 여부는 웹훅이 env 플래그로 결정한다 — 실사이트에서 워크플로우와
 * 충돌하지 않는지 확인한 뒤 켠다(채널톡 배정·워크플로우 협의 대기, 2026-09-03).
 *
 * 엔드포인트(PUT .../open + botName 쿼리)는 채널톡 공식 n8n 커넥터 소스로 확인했다
 * (channel-io/n8n-nodes-channel-talk, 2026-09-03). "여는 주체"를 봇으로 식별하도록
 * botName 을 실어 준다 — 메시지 발송과 같은 env(CHANNEL_TALK_BOT_NAME)를 쓴다.
 */
export async function openChannelTalkUserChat(userChatId: string): Promise<boolean> {
  const creds = credentials();
  if (!creds) {
    console.warn("[channel-talk api] 액세스 키 미설정 — 상담 열기를 건너뜀");
    return false;
  }

  const botName = process.env.CHANNEL_TALK_BOT_NAME?.trim();
  const query = botName ? `?botName=${encodeURIComponent(botName)}` : "";

  try {
    const response = await fetch(
      `${API_HOST}/open/v5/user-chats/${encodeURIComponent(userChatId)}/open${query}`,
      {
        method: "PUT",
        headers: {
          "x-access-key": creds.key,
          "x-access-secret": creds.secret,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }
    );
    if (!response.ok) {
      // 이미 열린 상담이면 여기서 거부될 수 있다(그 경우 이미 수신함에 있으므로 무해).
      // 원인 구분을 위해 응답 본문을 남긴다.
      console.warn(
        `[channel-talk api] 상담 열기 HTTP ${response.status}${await errorBody(response)}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      `[channel-talk api] 상담 열기 실패: ${error instanceof Error ? error.message : String(error)}`
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

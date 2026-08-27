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

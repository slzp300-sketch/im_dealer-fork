export const REFERRAL_MONTHLY_CAP = 10;
export const REFERRAL_COOKIE_NAME = "referral_code";
export const REFERRAL_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30일
/** 가입 완료 후 추천인 코드를 사후 입력할 수 있는 창구(일) */
export const REFERRAL_ENTRY_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AttributionRejectReason =
  | "INVALID_CODE"
  | "SELF_REFERRAL"
  | "INVITER_INACTIVE"
  | "ALREADY_ATTRIBUTED"
  | "MONTHLY_CAP"
  | "ENTRY_WINDOW_CLOSED";

export interface AttributionDecisionInput {
  inviteeUserId: string;
  inviterUserId: string | null;
  inviterIsActive: boolean;
  inviterKakaoId: string | null;
  inviteeKakaoId: string | null;
  alreadyAttributed: boolean;
  /** 이번 달(KST) 추천인 성공 건수 */
  inviterMonthCount: number;
  /** 인정 창구 안인지 — 최초 가입 완료 시점이거나, 완료 후 REFERRAL_ENTRY_WINDOW_DAYS 이내 */
  isWithinEntryWindow: boolean;
  code: string | null;
}

/**
 * 추천인 코드 사후 입력 창구가 열려 있는지.
 * 완료 시각이 미래인 비정상 케이스(시계 오차)는 관대하게 열림으로 본다.
 */
export function isReferralEntryWindowOpen(
  profileCompletedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!profileCompletedAt) return false;
  return (
    now.getTime() - profileCompletedAt.getTime() <=
    REFERRAL_ENTRY_WINDOW_DAYS * MS_PER_DAY
  );
}

/** 사후 입력 창구가 닫히는 시각 */
export function referralEntryDeadline(profileCompletedAt: Date): Date {
  return new Date(
    profileCompletedAt.getTime() + REFERRAL_ENTRY_WINDOW_DAYS * MS_PER_DAY,
  );
}

/** 사후 입력 창구의 잔여 일수(올림). 0이면 오늘 마감, 음수면 창구가 닫힌 상태다. */
export function referralEntryRemainingDays(
  profileCompletedAt: Date,
  now: Date = new Date(),
): number {
  return Math.ceil(
    (referralEntryDeadline(profileCompletedAt).getTime() - now.getTime()) /
      MS_PER_DAY,
  );
}

export type AttributionDecision =
  | { ok: true; inviterUserId: string; code: string }
  | { ok: false; reason: AttributionRejectReason };

export function decideReferralAttribution(
  input: AttributionDecisionInput,
): AttributionDecision {
  if (!input.isWithinEntryWindow) {
    return { ok: false, reason: "ENTRY_WINDOW_CLOSED" };
  }
  if (!input.code) {
    return { ok: false, reason: "INVALID_CODE" };
  }
  if (!input.inviterUserId) {
    return { ok: false, reason: "INVALID_CODE" };
  }
  if (input.inviterUserId === input.inviteeUserId) {
    return { ok: false, reason: "SELF_REFERRAL" };
  }
  if (
    input.inviterKakaoId &&
    input.inviteeKakaoId &&
    input.inviterKakaoId === input.inviteeKakaoId
  ) {
    return { ok: false, reason: "SELF_REFERRAL" };
  }
  if (!input.inviterIsActive) {
    return { ok: false, reason: "INVITER_INACTIVE" };
  }
  if (input.alreadyAttributed) {
    return { ok: false, reason: "ALREADY_ATTRIBUTED" };
  }
  if (input.inviterMonthCount >= REFERRAL_MONTHLY_CAP) {
    return { ok: false, reason: "MONTHLY_CAP" };
  }
  return {
    ok: true,
    inviterUserId: input.inviterUserId,
    code: input.code,
  };
}

/** Asia/Seoul 기준 이번 달 시작·다음 달 시작 (UTC Date) */
export function kstMonthRange(now: Date = new Date()): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  // KST = UTC+9
  const start = new Date(Date.UTC(year, month - 1, 1, -9, 0, 0, 0));
  const end =
    month === 12
      ? new Date(Date.UTC(year + 1, 0, 1, -9, 0, 0, 0))
      : new Date(Date.UTC(year, month, 1, -9, 0, 0, 0));
  return { start, end };
}

import { describe, expect, it } from "vitest";
import {
  decideReferralAttribution,
  isReferralEntryWindowOpen,
  kstMonthRange,
  REFERRAL_ENTRY_WINDOW_DAYS,
  REFERRAL_MONTHLY_CAP,
  referralEntryRemainingDays,
} from "./attribution";

const base = {
  inviteeUserId: "invitee-1",
  inviterUserId: "inviter-1",
  inviterIsActive: true,
  inviterKakaoId: "k-1",
  inviteeKakaoId: "k-2",
  alreadyAttributed: false,
  inviterMonthCount: 0,
  isWithinEntryWindow: true,
  code: "K4821",
};

describe("decideReferralAttribution", () => {
  it("accepts a valid referral within the entry window", () => {
    expect(decideReferralAttribution(base)).toEqual({
      ok: true,
      inviterUserId: "inviter-1",
      code: "K4821",
    });
  });

  it("rejects self referral and monthly cap", () => {
    expect(
      decideReferralAttribution({ ...base, inviterUserId: "invitee-1" }),
    ).toEqual({ ok: false, reason: "SELF_REFERRAL" });

    expect(
      decideReferralAttribution({
        ...base,
        inviterKakaoId: "same",
        inviteeKakaoId: "same",
      }),
    ).toEqual({ ok: false, reason: "SELF_REFERRAL" });

    expect(
      decideReferralAttribution({
        ...base,
        inviterMonthCount: REFERRAL_MONTHLY_CAP,
      }),
    ).toEqual({ ok: false, reason: "MONTHLY_CAP" });
  });

  it("rejects inactive inviter, duplicate, and closed entry window", () => {
    expect(
      decideReferralAttribution({ ...base, inviterIsActive: false }),
    ).toEqual({ ok: false, reason: "INVITER_INACTIVE" });
    expect(
      decideReferralAttribution({ ...base, alreadyAttributed: true }),
    ).toEqual({ ok: false, reason: "ALREADY_ATTRIBUTED" });
    expect(
      decideReferralAttribution({ ...base, isWithinEntryWindow: false }),
    ).toEqual({ ok: false, reason: "ENTRY_WINDOW_CLOSED" });
  });
});

describe("isReferralEntryWindowOpen", () => {
  const now = new Date("2026-08-18T12:00:00+09:00");
  const msPerDay = 24 * 60 * 60 * 1000;

  it("가입 미완료(completedAt 없음)면 닫힘", () => {
    expect(isReferralEntryWindowOpen(null, now)).toBe(false);
  });

  it("완료 직후와 창구 마지막 날까지는 열림", () => {
    expect(isReferralEntryWindowOpen(now, now)).toBe(true);
    const edge = new Date(
      now.getTime() - REFERRAL_ENTRY_WINDOW_DAYS * msPerDay,
    );
    expect(isReferralEntryWindowOpen(edge, now)).toBe(true);
  });

  it("창구를 하루라도 넘기면 닫힘", () => {
    const past = new Date(
      now.getTime() - (REFERRAL_ENTRY_WINDOW_DAYS + 1) * msPerDay,
    );
    expect(isReferralEntryWindowOpen(past, now)).toBe(false);
  });

  it("완료 시각이 미래여도(시계 오차) 관대하게 열림 처리", () => {
    const future = new Date(now.getTime() + msPerDay);
    expect(isReferralEntryWindowOpen(future, now)).toBe(true);
  });

  it("마감 시각은 완료 시각 + 창구 일수", async () => {
    const { referralEntryDeadline } = await import("./attribution");
    expect(referralEntryDeadline(now).getTime()).toBe(
      now.getTime() + REFERRAL_ENTRY_WINDOW_DAYS * msPerDay,
    );
  });
});

describe("referralEntryRemainingDays", () => {
  const now = new Date("2026-08-18T12:00:00+09:00");
  const msPerDay = 24 * 60 * 60 * 1000;

  it("완료 직후에는 창구 일수 전체가 남는다", () => {
    expect(referralEntryRemainingDays(now, now)).toBe(REFERRAL_ENTRY_WINDOW_DAYS);
  });

  it("하루 지나면 1 줄고, 마감 당일은 0(오늘 마감)이다", () => {
    const dayAgo = new Date(now.getTime() - msPerDay);
    expect(referralEntryRemainingDays(dayAgo, now)).toBe(
      REFERRAL_ENTRY_WINDOW_DAYS - 1,
    );
    const deadline = new Date(
      now.getTime() - REFERRAL_ENTRY_WINDOW_DAYS * msPerDay,
    );
    expect(referralEntryRemainingDays(deadline, now)).toBe(0);
  });

  it("남은 시간이 하루 미만이면 올림한다", () => {
    const almostDeadline = new Date(
      now.getTime() - (REFERRAL_ENTRY_WINDOW_DAYS * msPerDay - 60_000),
    );
    expect(referralEntryRemainingDays(almostDeadline, now)).toBe(1);
  });

  it("창구가 지나면 음수다", () => {
    const past = new Date(
      now.getTime() - (REFERRAL_ENTRY_WINDOW_DAYS + 1) * msPerDay,
    );
    expect(referralEntryRemainingDays(past, now)).toBeLessThan(0);
  });
});

describe("kstMonthRange", () => {
  it("returns a non-empty month window", () => {
    const { start, end } = kstMonthRange(new Date("2026-08-15T12:00:00+09:00"));
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});

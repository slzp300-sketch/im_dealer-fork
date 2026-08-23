import { Prisma, type PrismaClient } from "@prisma/client";
import { generateCouponCode } from "@/lib/coupons/code";
import {
  decideReferralAttribution,
  kstMonthRange,
} from "./attribution";
import { normalizeReferralCode } from "./code";

export type Db = PrismaClient | Prisma.TransactionClient;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** refereeId 유니크 위반 — 동시 적용(경합)에서 진 쪽이 받는 유일한 신호 */
function isRefereeIdUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.includes("refereeId");
  return String(target ?? "").includes("refereeId");
}

/**
 * 거절을 어뷰즈 원장에 남긴다. refereeId @unique 로 슬롯이 1개뿐이라
 * BLOCKED 행은 해당 회원의 평생 1회 기회를 소진한다(종단 거절).
 * 이미 슬롯을 점유한 경우(P2002) 기록이 존재하므로 결과만 반환한다.
 */
async function recordBlockedReferral(input: {
  db: Db;
  referrerId: string;
  refereeId: string;
  code: string;
  signupIpHash: string | null | undefined;
}): Promise<void> {
  try {
    await input.db.referral.create({
      data: {
        referrerId: input.referrerId,
        refereeId: input.refereeId,
        code: input.code,
        status: "BLOCKED",
        signupIpHash: input.signupIpHash ?? null,
      },
      select: { id: true },
    });
  } catch (err) {
    if (isRefereeIdUniqueViolation(err)) return;
    throw err;
  }
}

export interface ApplyReferralInput {
  inviteeUserId: string;
  rawCode: string | null | undefined;
  /** 인정 창구 안인지 — 최초 가입 완료 시점이거나 완료 후 창구(14일) 이내 */
  isWithinEntryWindow: boolean;
  inviteeKakaoId: string | null;
  signupIpHash?: string | null;
}

export type ApplyReferralResult =
  | { applied: true; inviterUserId: string; referralId: string }
  | { applied: false; reason: string };

/**
 * 가입 완료 시점에 추천 코드를 인정하고 쿠폰을 발급한다.
 * DB 모델: Referral(referrerId/refereeId) + CouponTrigger REFERRAL_GIVEN/RECEIVED
 */
export async function applyReferralOnProfileComplete(
  input: ApplyReferralInput,
  db: Db,
): Promise<ApplyReferralResult> {
  const code = normalizeReferralCode(input.rawCode);
  if (!code) {
    return { applied: false, reason: "INVALID_CODE" };
  }

  const inviter = await db.user.findUnique({
    where: { referralCode: code },
    select: {
      id: true,
      isActive: true,
      kakaoId: true,
    },
  });

  const already = await db.referral.findUnique({
    where: { refereeId: input.inviteeUserId },
    select: { id: true },
  });

  // 월 한도 count 는 호출부 트랜잭션(tx) 안에서 읽는다.
  // T18: redeem-code / complete-profile 가 prisma.$transaction((tx) => apply(..., tx)).
  // refereeId @unique + create P2002→ALREADY_ATTRIBUTED 가 피추천인 슬롯을 직렬화한다.
  // 서로 다른 피추천인 동시 적용은 READ COMMITTED 에서 count 가 둘 다 9를 읽을 수 있다.
  // MONTHLY_CAP 은 BLOCKED 를 남기지 않으므로(T18) 초과분은 원장 감사로 회수한다.
  // User FOR UPDATE 는 T18 직렬화 계약을 바꾸므로 넣지 않는다.
  const { start, end } = kstMonthRange();
  const monthCount = inviter
    ? await db.referral.count({
        where: {
          referrerId: inviter.id,
          status: "REWARDED",
          createdAt: { gte: start, lt: end },
        },
      })
    : 0;

  const decision = decideReferralAttribution({
    inviteeUserId: input.inviteeUserId,
    inviterUserId: inviter?.id ?? null,
    inviterIsActive: inviter?.isActive ?? false,
    inviterKakaoId: inviter?.kakaoId ?? null,
    inviteeKakaoId: input.inviteeKakaoId,
    alreadyAttributed: Boolean(already),
    inviterMonthCount: monthCount,
    isWithinEntryWindow: input.isWithinEntryWindow,
    code,
  });

  if (!decision.ok) {
    // B6 거절 기록: 자기 추천(본인 코드·동일 카카오 다계정)은 어뷰즈로 BLOCKED 행을 남긴다.
    // 이후 재시도는 findUnique 가 BLOCKED 행을 발견해 ALREADY_ATTRIBUTED 로 막힌다(의도된 영구 차단).
    // ALREADY_ATTRIBUTED 는 슬롯을 이미 점유한 기존 행이 곧 기록이라 추가 행이 불가능하고,
    // INVALID_CODE 는 referrerId FK 를 채울 추천인이 없으며,
    // INVITER_INACTIVE / MONTHLY_CAP / ENTRY_WINDOW_CLOSED 는 피초청자 잘못이 아니므로
    // 슬롯을 소진해 재시도(다른 코드·다음 달)까지 막아서는 안 된다.
    if (decision.reason === "SELF_REFERRAL" && inviter) {
      await recordBlockedReferral({
        db,
        referrerId: inviter.id,
        refereeId: input.inviteeUserId,
        code,
        signupIpHash: input.signupIpHash,
      });
    }
    return { applied: false, reason: decision.reason };
  }

  let referralId: string;
  try {
    const referral = await db.referral.create({
      data: {
        referrerId: decision.inviterUserId,
        refereeId: input.inviteeUserId,
        code: decision.code,
        status: "REWARDED",
        signupIpHash: input.signupIpHash ?? null,
      },
      select: { id: true },
    });
    referralId = referral.id;
  } catch (err) {
    if (isRefereeIdUniqueViolation(err)) {
      // 조회→생성 사이 동시 적용: refereeId 유니크 가드가 승자 1건만 남긴다.
      // 패자는 '이미 적용됨'으로 응답해 redeem-code 가 500 이 아닌 409 를 내리게 한다.
      // 이 시점 트랜잭션엔 쓰기가 없었으므로 커밋되어도 부분 커밋이 없다.
      return { applied: false, reason: "ALREADY_ATTRIBUTED" };
    }
    throw err;
  }

  await issueReferralCoupons({
    referralId,
    inviterUserId: decision.inviterUserId,
    inviteeUserId: input.inviteeUserId,
    now: new Date(),
    db,
  });

  return {
    applied: true,
    inviterUserId: decision.inviterUserId,
    referralId,
  };
}

async function issueReferralCoupons(input: {
  referralId: string;
  inviterUserId: string;
  inviteeUserId: string;
  now: Date;
  db: Db;
}): Promise<void> {
  const policies = await input.db.couponPolicy.findMany({
    where: {
      isActive: true,
      trigger: { in: ["REFERRAL_GIVEN", "REFERRAL_RECEIVED"] },
    },
    select: {
      id: true,
      trigger: true,
      title: true,
      rewardLabel: true,
      rewardAmount: true,
      validDays: true,
      startsAt: true,
      endsAt: true,
    },
  });

  for (const policy of policies) {
    if (policy.startsAt && policy.startsAt.getTime() > input.now.getTime()) continue;
    if (policy.endsAt && policy.endsAt.getTime() <= input.now.getTime()) continue;

    const userId =
      policy.trigger === "REFERRAL_GIVEN"
        ? input.inviterUserId
        : input.inviteeUserId;

    const expiresAt =
      policy.validDays === null
        ? null
        : new Date(input.now.getTime() + policy.validDays * MS_PER_DAY);

    // 호출부가 트랜잭션으로 감싸므로 실패하면 Referral 행과 함께 전부 롤백된다.
    // IssuedCoupon 은 부분 유니크 2개로 보호된다(마이그레이션 20260819000000 이 단일 진실 공급원):
    //   IssuedCoupon_referral_unique (policyId, referralId) WHERE referralId IS NOT NULL
    //   IssuedCoupon_nonreferral_unique (userId, policyId) WHERE referralId IS NULL
    // 이 발급 경로는 referralId 가 항상 NOT NULL 이므로 referral 유니크가 (policyId, referralId) 차원에서
    // 중복 발급을 스키마 수준에서도 막는다(발급 로직의 Referral 1행당 1회 원칙과 이중 방어).
    await input.db.issuedCoupon.create({
      data: {
        userId,
        policyId: policy.id,
        code: generateCouponCode(),
        status: "HELD",
        titleSnapshot: policy.title,
        rewardLabelSnapshot: policy.rewardLabel,
        rewardAmountSnapshot: policy.rewardAmount,
        expiresAt,
        referralId: input.referralId,
      },
    });
  }
}

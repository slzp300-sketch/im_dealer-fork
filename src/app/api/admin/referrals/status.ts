// 추천 원장 상태 처리 도메인 로직 — HTTP 래퍼([id]/status/route.ts)와 분리.
// 쿠폰 지급/회수(pay.ts·revoke.ts)와 같은 계층 구조를 따른다.

import { Prisma, type PrismaClient } from "@prisma/client";
import type { ReferralStatus } from "@prisma/client";

export type Db = PrismaClient | Prisma.TransactionClient;

export type ReferralStatusAction = "unblock" | "revoke";

/**
 * 허용 상태 전이 표(단일 진실 공급원).
 *
 * | 현재      | 허용되는 처리                          |
 * |-----------|----------------------------------------|
 * | REWARDED  | revoke  → REVOKED (보상 철회)           |
 * | BLOCKED   | unblock → 행 삭제(슬롯 해제)            |
 * | REVOKED   | (없음 — 소급 복원 금지)                 |
 *
 * - BLOCKED → REWARDED 직접 승격 금지: 인정(REWARDED)은 가입 창구의
 *   applyReferralOnProfileComplete 경로에서만 생성되어야 월 한도·쿠폰
 *   발급 무결성이 유지된다.
 * - REWARDED → BLOCKED 금지: 어뷰즈 차단은 가입 시점 판정(apply.ts)의
 *   전유물이다. 사후 조치는 철회(revoke)로 충분하다.
 * - REVOKED → * 금지: 철회된 보상을 원장에서 소급 복원하면 감사 이력과
 *   어긋난다. 필요 시 원장을 다시 적용 경로로 만들어야 한다(현재 미지원).
 */
export const REFERRAL_ALLOWED_TRANSITIONS = {
  REWARDED: ["REVOKED"],
  BLOCKED: [],
  REVOKED: [],
} as const satisfies Record<ReferralStatus, readonly ReferralStatus[]>;

/** 감사 로그 before 로 남길 원장 스냅샷(ISO 직렬화). */
export interface ReferralStatusBefore {
  id: string;
  referrerId: string;
  refereeId: string;
  code: string;
  status: ReferralStatus;
  signupIpHash: string | null;
  createdAt: string;
}

export type ReferralStatusChangeResult =
  | { ok: true; action: ReferralStatusAction; before: ReferralStatusBefore }
  | { ok: false; reason: "not_found" }
  | {
      ok: false;
      reason: "invalid_transition";
      action: ReferralStatusAction;
      status: ReferralStatus;
    }
  | { ok: false; reason: "conflict" };

function toBefore(row: {
  id: string;
  referrerId: string;
  refereeId: string;
  code: string;
  status: ReferralStatus;
  signupIpHash: string | null;
  createdAt: Date;
}): ReferralStatusBefore {
  return {
    id: row.id,
    referrerId: row.referrerId,
    refereeId: row.refereeId,
    code: row.code,
    status: row.status,
    signupIpHash: row.signupIpHash,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * BLOCKED 해제. 행을 삭제하면 refereeId @unique 슬롯이 비워져 해당 회원이
 * 가입 창구(최초 완료 또는 14일 이내)에서 다시 추천 코드를 적용할 수 있다 —
 * 이것이 T18 종단 거절(SELF_REFERRAL → BLOCKED)의 외길문을 여는 유일한 경로다.
 * 삭제된 원장 행은 before 스냅샷으로 AdminAuditLog 에 영구 보존되므로
 * 감사 추적 가능성은 유지된다(악용은 admin+ 권한 + 사유 필수로 방어).
 */
async function unblock(
  id: string,
  db: Db
): Promise<ReferralStatusChangeResult> {
  const current = await db.referral.findUnique({
    where: { id },
    select: {
      id: true,
      referrerId: true,
      refereeId: true,
      code: true,
      status: true,
      signupIpHash: true,
      createdAt: true,
    },
  });
  if (!current) return { ok: false, reason: "not_found" };
  // 해제는 BLOCKED 에만 허용 — REWARDED/REVOKED 행을 지우면 원장이 소실된다.
  if (current.status !== "BLOCKED") {
    return {
      ok: false,
      reason: "invalid_transition",
      action: "unblock",
      status: current.status,
    };
  }

  // 조건부 삭제: 사전 조회와 삭제 사이 상태가 바뀌었으면 0건 → conflict.
  const deleted = await db.referral.deleteMany({
    where: { id, status: "BLOCKED" },
  });
  if (deleted.count === 0) return { ok: false, reason: "conflict" };

  return { ok: true, action: "unblock", before: toBefore(current) };
}

/** REWARDED → REVOKED (보상 철회). 조건부 갱신으로 경합을 안전하게 처리한다. */
async function revoke(
  id: string,
  db: Db
): Promise<ReferralStatusChangeResult> {
  const current = await db.referral.findUnique({
    where: { id },
    select: {
      id: true,
      referrerId: true,
      refereeId: true,
      code: true,
      status: true,
      signupIpHash: true,
      createdAt: true,
    },
  });
  if (!current) return { ok: false, reason: "not_found" };
  // 허용 전이 표 기준 — BLOCKED(보상 없음)·REVOKED(이미 철회)는 무효.
  if (!(REFERRAL_ALLOWED_TRANSITIONS[current.status] as readonly string[]).includes("REVOKED")) {
    return {
      ok: false,
      reason: "invalid_transition",
      action: "revoke",
      status: current.status,
    };
  }

  const updated = await db.referral.updateMany({
    where: { id, status: "REWARDED" },
    data: { status: "REVOKED" },
  });
  if (updated.count === 0) return { ok: false, reason: "conflict" };

  return { ok: true, action: "revoke", before: toBefore(current) };
}

export async function applyReferralStatusAction(
  id: string,
  action: ReferralStatusAction,
  _actorId: string,
  _reason: string,
  db: Db
): Promise<ReferralStatusChangeResult> {
  // actorId·reason 은 HTTP 래퍼가 감사 로그로 남긴다. 도메인 함수는
  // 원장 상태만 책임진다(쿠폰 pay/revoke 의 actorId 기록 필드가 Referral 에는 없다).
  if (action === "unblock") return unblock(id, db);
  return revoke(id, db);
}

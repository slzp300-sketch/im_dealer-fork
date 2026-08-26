// 알림톡 발송 큐 상태 조회 (어드민 > 시스템 > 알림톡 큐).
// 조회 전용 화면이라 CRUD/API 라우트 없이 SSR 쿼리만 제공한다.
// 새로고침(페이지 진입) 시점 스냅샷이면 충분해 폴링도 두지 않는다.

import { prisma } from "../prisma";

/** AlimtalkMessage.status 원형. 스키마가 String 이라 여기서 상수로 관리한다. */
export const ALIMTALK_QUEUE_STATUSES = [
  "PENDING",
  "SENDING",
  "ACCEPTED",
  "SENT",
  "FAILED",
] as const;

export type AlimtalkStatus = (typeof ALIMTALK_QUEUE_STATUSES)[number];

export type AlimtalkQueueCounts = Record<AlimtalkStatus, number>;

export interface AlimtalkFailedItem {
  id: string;
  templateKey: string;
  /** 비즈톡센터에 등록된 템플릿 코드. 3015(템플릿 없음) 진단에 이 값이 필요하다. */
  templateCode: string;
  /** "quote" | "consult" | "review" — 스키마가 자유 문자열이라 null 가능 */
  refType: string | null;
  refId: string | null;
  failReason: string | null;
  resultCode: string | null;
  attempts: number;
  /** 큐 적재 시각 (ISO) */
  createdAt: string;
  /** 실패 확정 시각 (ISO). resultAt 없으면 updatedAt */
  failedAt: string;
}

export interface AlimtalkQueueStatus {
  counts: AlimtalkQueueCounts;
  /** PENDING 이 쌓여 있는지 판단할 재료 — 가장 오래된 대기 건 적재 시각 (ISO) */
  oldestPendingAt: string | null;
  recentFailures: AlimtalkFailedItem[];
}

const RECENT_FAILURES_LIMIT = 10;

export async function getAlimtalkQueueStatus(): Promise<AlimtalkQueueStatus> {
  const [statusRows, oldestPending, failedRows] = await Promise.all([
    prisma.alimtalkMessage.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.alimtalkMessage.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.alimtalkMessage.findMany({
      where: { status: "FAILED" },
      orderBy: [
        { resultAt: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
      take: RECENT_FAILURES_LIMIT,
      select: {
        id: true,
        templateKey: true,
        templateCode: true,
        refType: true,
        refId: true,
        failReason: true,
        resultCode: true,
        attempts: true,
        createdAt: true,
        resultAt: true,
        updatedAt: true,
        // PII: recipient(암호화 수신번호)와 message(고객명이 포함된 본문)는
        // 어드민 화면으로 내보내지 않는다. 이 select 에 추가 금지.
      },
    }),
  ]);

  const counts: AlimtalkQueueCounts = {
    PENDING: 0,
    SENDING: 0,
    ACCEPTED: 0,
    SENT: 0,
    FAILED: 0,
  };
  for (const row of statusRows) {
    if ((ALIMTALK_QUEUE_STATUSES as readonly string[]).includes(row.status)) {
      counts[row.status as AlimtalkStatus] = row._count._all;
    }
  }

  return {
    counts,
    oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null,
    recentFailures: failedRows.map((row) => ({
      id: row.id,
      templateKey: row.templateKey,
      templateCode: row.templateCode,
      refType: row.refType,
      refId: row.refId,
      failReason: row.failReason,
      resultCode: row.resultCode,
      attempts: row.attempts,
      createdAt: row.createdAt.toISOString(),
      failedAt: (row.resultAt ?? row.updatedAt).toISOString(),
    })),
  };
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AlimtalkQueueStatus } from "@/lib/admin-queries/alimtalk-queue";
import { AlimtalkQueueBoard } from "./AlimtalkQueueBoard";

// formatRelativeTime 는 Date.now() 기준 — 고정 시각으로 결정적으로 검증한다.
const NOW = new Date("2026-08-19T09:00:00.000Z");

function fixture(overrides: Partial<AlimtalkQueueStatus> = {}): AlimtalkQueueStatus {
  return {
    counts: { PENDING: 3, SENDING: 1, ACCEPTED: 2, SENT: 57, FAILED: 4 },
    oldestPendingAt: new Date("2026-08-19T08:18:00.000Z").toISOString(),
    recentFailures: [],
    ...overrides,
  };
}

function failure(overrides: Record<string, unknown> = {}) {
  return {
    id: "alim-1",
    templateKey: "QUOTE_DELIVERED",
    templateCode: "imdealer_quote_delivered",
    refType: "quote",
    refId: "ck8qz1x2y3w4v5",
    failReason: "3019 카카오톡 미가입 사용자",
    resultCode: "3019",
    attempts: 3,
    createdAt: new Date("2026-08-19T08:55:00.000Z").toISOString(),
    failedAt: new Date("2026-08-19T08:57:00.000Z").toISOString(),
    ...overrides,
  };
}

describe("AlimtalkQueueBoard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("큐 상태별 카운트 카드를 렌더한다", () => {
    render(<AlimtalkQueueBoard status={fixture()} />);

    for (const label of ["대기", "전송 중", "접수됨", "완료", "실패"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    for (const count of ["3", "1", "2", "57", "4"]) {
      expect(screen.getByText(count)).toBeInTheDocument();
    }
  });

  it("PENDING 이 있으면 가장 오래된 대기 경과를 보여준다", () => {
    render(<AlimtalkQueueBoard status={fixture()} />);

    expect(screen.getByText(/가장 오래된 대기/)).toBeInTheDocument();
    expect(screen.getByText(/42분 전/)).toBeInTheDocument();
  });

  it("빈 큐일 때 안내 상태를 보여준다", () => {
    render(
      <AlimtalkQueueBoard
        status={fixture({
          counts: { PENDING: 0, SENDING: 0, ACCEPTED: 0, SENT: 0, FAILED: 0 },
          oldestPendingAt: null,
          recentFailures: [],
        })}
      />
    );

    expect(screen.getByText(/큐가 비어 있습니다/)).toBeInTheDocument();
    expect(screen.getByText(/최근 실패 건이 없습니다/)).toBeInTheDocument();
  });

  it("최근 실패 목록에 사유·구분·시각을 렌더한다", () => {
    render(
      <AlimtalkQueueBoard
        status={fixture({
          recentFailures: [
            failure(),
            failure({
              id: "alim-2",
              templateKey: "REVIEW_REQUEST",
              templateCode: "imdealer_review_request",
              refType: "review",
              refId: "ck_review_99",
              failReason: null,
              resultCode: "3020",
              attempts: 1,
              createdAt: new Date("2026-08-19T08:40:00.000Z").toISOString(),
              failedAt: new Date("2026-08-19T08:41:00.000Z").toISOString(),
            }),
          ],
        })}
      />
    );

    // 사유 — failReason 원문 그대로
    expect(screen.getByText("3019 카카오톡 미가입 사용자")).toBeInTheDocument();
    // failReason 이 없으면 결과코드로 대체
    expect(screen.getByText("결과코드 3020")).toBeInTheDocument();
    // 구분 라벨
    expect(screen.getByText("견적")).toBeInTheDocument();
    expect(screen.getByText("리뷰")).toBeInTheDocument();
    // 템플릿 키 + 비즈톡 템플릿 코드(3015 진단에 필요)
    expect(screen.getByText("QUOTE_DELIVERED")).toBeInTheDocument();
    expect(screen.getByText("REVIEW_REQUEST")).toBeInTheDocument();
    expect(screen.getByText("imdealer_quote_delivered")).toBeInTheDocument();
    expect(screen.getByText("imdealer_review_request")).toBeInTheDocument();
    // 시도 횟수
    expect(screen.getByText("3회")).toBeInTheDocument();
    expect(screen.getByText("1회")).toBeInTheDocument();
    // 시각 (failedAt 기준 상대 시간)
    expect(screen.getByText("3분 전")).toBeInTheDocument();
    expect(screen.getByText("19분 전")).toBeInTheDocument();
  });
});

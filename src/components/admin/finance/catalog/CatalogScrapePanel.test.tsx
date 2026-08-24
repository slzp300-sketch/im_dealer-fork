import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CatalogScrapePanel from "./CatalogScrapePanel";
import type { CatalogJobState } from "./CapitalCatalogManager";

// 워커 상태 배지는 자체 폴링을 돌린다 — 패널 로직 검증에는 불필요.
vi.mock("../WorkerStatusBadge", () => ({ default: () => null }));
// 로그인 모달 대신 제출만 흉내내 잡 생성 payload 를 검사한다.
vi.mock("../ScraperLoginModal", () => ({
  default: ({
    onSubmit,
    serverError,
  }: {
    onSubmit: (u: string, p: string, w: string) => void;
    serverError?: string | null;
  }) => (
    <div data-testid="login-modal">
      <button type="button" onClick={() => onSubmit("id", "pw", "pc1")}>
        로그인제출
      </button>
      {serverError && <p>{serverError}</p>}
    </div>
  ),
}));

const IDLE: CatalogJobState = {
  jobId: null, jobType: null, status: null, progress: null, summary: null, error: null, humanPrompt: null,
};

// 오릭스 = 자동 로그인 캐피탈사, 브랜드 목록은 capital-brands 에 내장돼 있다.
const BASE_PROPS = {
  financeCompanyId: "fc-1",
  financeCompanyName: "오릭스캐피탈",
  productType: "장기렌트",
  job: IDLE,
  onJobStarted: vi.fn(),
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const KIA_MODELS = [
  { modelCd: "M1", modelName: "쏘렌토", trimCount: 12, lastScrapedAt: daysAgo(2) }, // 1주 이내 → 초록
  { modelCd: "M2", modelName: "스포티지", trimCount: 8, lastScrapedAt: daysAgo(15) }, // 1달 이내 → 주황
  { modelCd: "M3", modelName: "카니발", trimCount: 10, lastScrapedAt: null }, // 미수집 → 빨강
  { modelCd: "M4", modelName: "K5", trimCount: 6, lastScrapedAt: daysAgo(45) }, // 1달 이상 → 빨강
];

let posted: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, json: async () => ({ success: true, jobId: "job-1" }) };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, models: KIA_MODELS }) };
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** 기아 브랜드를 켜고 차량 목록이 뜰 때까지 기다린다. */
async function openKia() {
  fireEvent.click(screen.getByRole("checkbox", { name: "기아" }));
  await waitFor(() => expect(screen.getByRole("button", { name: /쏘렌토/ })).toBeTruthy());
}

describe("CatalogScrapePanel", () => {
  it("여러 차량을 골라 한 번에 수집한다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();

    for (const name of ["쏘렌토", "스포티지", "카니발"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));
    }
    // 고른 차량 요약이 3대를 모아 보여준다
    expect(screen.getByText("고른 차량 3대")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "수집 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "로그인제출" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0].body as { jobType: string; brands: { modelCds: string[] }[] };
    expect(body.jobType).toBe("catalog");
    // 고른 3대만 실린다 — K5 는 빠진다
    expect(body.brands[0].modelCds.sort()).toEqual(["M1", "M2", "M3"]);
  });

  it("차량을 안 골랐으면 수집을 시작할 수 없다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();
    expect(screen.getByRole("button", { name: "수집 시작" }).hasAttribute("disabled")).toBe(true);
  });

  it("브랜드 전체 범위는 modelCds 없이 보낸다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();

    fireEvent.click(screen.getByRole("button", { name: /브랜드 전체/ }));
    fireEvent.click(screen.getByRole("button", { name: "수집 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "로그인제출" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const body = posted[0].body as { brands: Record<string, unknown>[] };
    expect(body.brands[0].modelCds).toBeUndefined();
  });

  it("차량 목록 가져오기는 models 잡을 만든다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();

    fireEvent.click(screen.getByRole("button", { name: "차량 목록 가져오기" }));
    fireEvent.click(screen.getByRole("button", { name: "로그인제출" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect((posted[0].body as { jobType: string }).jobType).toBe("models");
    // 목록 잡에는 수집 범위(weekOf·modelCds)가 실리지 않는다
    expect(posted[0].body.weekOf).toBeUndefined();
  });

  it("수집 PC 오프라인 409 는 모달을 닫지 않고 그 안에 사유를 보여준다", async () => {
    const offlineMsg = "'pc1' 수집 PC 가 접속돼 있지 않습니다.";
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: false, status: 409, json: async () => ({ error: offlineMsg }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, models: KIA_MODELS }) };
    }));
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();

    fireEvent.click(screen.getByRole("button", { name: /쏘렌토/ }));
    fireEvent.click(screen.getByRole("button", { name: "수집 시작" }));
    fireEvent.click(screen.getByRole("button", { name: "로그인제출" }));

    await waitFor(() => expect(screen.getAllByText(offlineMsg)).toHaveLength(1));
    // 모달이 열린 채 그 안에 사유가 표시된다 — 모달 뒤 패널에는 중복 표시하지 않는다
    expect(screen.getByTestId("login-modal")).toBeTruthy();
  });

  it("차량 칩을 수집일 신선도 배경색으로 표시한다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();
    const chipCls = (name: RegExp) => screen.getByRole("button", { name }).className;
    expect(chipCls(/쏘렌토/)).toContain("bg-emerald-50"); // 1주 이내
    expect(chipCls(/스포티지/)).toContain("bg-amber-50"); // 1달 이내
    expect(chipCls(/K5/)).toContain("bg-red-50"); // 1달 이상
    // 미수집은 빨강 배경 + "미수집" 라벨
    expect(screen.getByRole("button", { name: /카니발.*미수집/ }).className).toContain("bg-red-50");
  });

  it("완료 카드에 실패 내역(무엇이 왜)을 표시한다", () => {
    const job: CatalogJobState = {
      jobId: "job-1", jobType: "catalog", status: "completed", progress: null, error: null, humanPrompt: null,
      summary: {
        mode: "catalog", total: 11, skipped: 0, failed: 5,
        brands: [{ brandCd: "HYUNDAI", name: "현대", trims: 11 }],
        models: [{ brandName: "현대", modelName: "더 뉴 스타리아", trims: 11 }],
        failures: [
          { label: "더 뉴 스타리아 라운지 9인승", reason: "잔존율 조회 실패(세션 차단)" },
          { label: "더 뉴 스타리아 카고 3인승", reason: "월납입금 산출 0건" },
        ],
        finishedAt: new Date().toISOString(),
      },
    };
    render(<CatalogScrapePanel {...BASE_PROPS} job={job} />);
    expect(screen.getByText("실패 내역")).toBeTruthy();
    expect(screen.getByText("더 뉴 스타리아 라운지 9인승")).toBeTruthy();
    expect(screen.getByText(/잔존율 조회 실패/)).toBeTruthy();
    // failed(5) > 동봉된 내역(2) — 상한 초과분 안내
    expect(screen.getByText(/외 3건/)).toBeTruthy();
  });

  it("구버전 워커 결과(failures 없음)면 실패 내역 블록을 숨긴다", () => {
    const job: CatalogJobState = {
      jobId: "job-1", jobType: "catalog", status: "completed", progress: null, error: null, humanPrompt: null,
      summary: {
        mode: "catalog", total: 11, skipped: 0, failed: 5,
        brands: [{ brandCd: "HYUNDAI", name: "현대", trims: 11 }],
        finishedAt: new Date().toISOString(),
      },
    };
    render(<CatalogScrapePanel {...BASE_PROPS} job={job} />);
    expect(screen.queryByText("실패 내역")).toBeNull();
  });

  it("검색으로 차량을 좁힌다", async () => {
    render(<CatalogScrapePanel {...BASE_PROPS} />);
    await openKia();

    fireEvent.change(screen.getByPlaceholderText("차량명 검색"), { target: { value: "쏘렌" } });
    expect(screen.getByRole("button", { name: /쏘렌토/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /카니발/ })).toBeNull();
  });
});

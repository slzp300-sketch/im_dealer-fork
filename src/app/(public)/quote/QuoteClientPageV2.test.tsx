import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { CHANNEL_TALK_STATUS_ATTR } from "@/lib/channel-talk-status";
import { QuoteClientPageV2 } from "./QuoteClientPageV2";
import {
  createUnlockedCalculatedQuoteResult,
  createFetchMock,
  savedQuoteSuccessData,
  vehicles,
  writeCalculatedRestore,
  writeConsultationRestore,
  writeFirstEntryRestore,
  writeGuestAllLockedRestore,
  writeGuestGatedFirstEntryRestore,
  writeLockedCalculatedRestore,
} from "./QuoteClientPageV2.test-fixtures";

type MockAuthUser = {
  readonly id: string;
} | null;

const navigationMock = vi.hoisted(() => ({
  router: {
    back: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
  },
  searchParams: new URLSearchParams("vehicle=preparing-car&customerType=individual&restore=1"),
}));

const supabaseMock = vi.hoisted(() => ({
  getUser: vi.fn<
    () => Promise<{ readonly data: { readonly user: MockAuthUser } }>
  >(async () => ({ data: { user: null } })),
  signInWithOAuth: vi.fn<
    (params: {
      readonly provider: string;
      readonly options?: { readonly redirectTo?: string };
    }) => Promise<{
      readonly data: { readonly provider: string; readonly url: string | null };
      readonly error: null;
    }>
  >(async () => ({ data: { provider: "kakao", url: null }, error: null })),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigationMock.router,
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: supabaseMock.getUser,
      signInWithOAuth: supabaseMock.signInWithOAuth,
      onAuthStateChange: supabaseMock.onAuthStateChange,
    },
  }),
}));

beforeEach(() => {
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "true");
  // 자동발송(나에게 보내기) 테스트용 — 기본 흐름은 채널추가 수동 발송이므로 명시적으로 켠다.
  vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://imdealer.example");
  supabaseMock.getUser.mockReset();
  supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
  supabaseMock.signInWithOAuth.mockReset();
  supabaseMock.signInWithOAuth.mockResolvedValue({
    data: { provider: "kakao", url: null },
    error: null,
  });
});

afterEach(() => {
  delete window.ChannelIO;
  document.documentElement.removeAttribute(CHANNEL_TALK_STATUS_ATTR);
  delete window.gtag;
  window.localStorage.clear();
  // 자동 재개 1회 예산은 sessionStorage 에 있다 — 테스트 간 누수 금지.
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  navigationMock.searchParams = new URLSearchParams("vehicle=preparing-car&customerType=individual&restore=1");
  navigationMock.router.back.mockReset();
  navigationMock.router.push.mockReset();
  navigationMock.router.replace.mockReset();
});

describe("QuoteClientPageV2 consultation fallback", () => {
  it("keeps the quote result summary and shows consultation guidance for a restored consultation result", async () => {
    writeConsultationRestore();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, data: [] }))
    );

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    await screen.findByText("이 차량은 별도 상담이 필요합니다");

    expect(screen.getByText("준비중 차량")).toBeInTheDocument();
    expect(screen.getByText("프리미엄")).toBeInTheDocument();
    expect(screen.getByText("상품")).toBeInTheDocument();
    expect(screen.getByText("장기렌트")).toBeInTheDocument();
    expect(screen.getByText("계약기간")).toBeInTheDocument();
    expect(screen.getByText("60개월")).toBeInTheDocument();
    expect(screen.getByText("약정거리")).toBeInTheDocument();
    expect(screen.getByText("연 2만km")).toBeInTheDocument();
    expect(screen.getByText("월 납입금")).toBeInTheDocument();
    expect(screen.getByText("별도 상담 필요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "선택 조건으로 상담 요청하기" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "견적서 받기" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("문제가 발생했습니다")).not.toBeInTheDocument();
    });
  });

  it("continues to consultation result when the selected vehicle has no trims", async () => {
    navigationMock.searchParams = new URLSearchParams("vehicle=preparing-car&customerType=individual");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input.toString();
        if (url.endsWith("/colors")) {
          return Response.json({ success: true, data: [] });
        }
        if (url.endsWith("/trims")) {
          return Response.json({ success: true, data: [] });
        }
        if (url.endsWith("/quote")) {
          return Response.json({
            success: true,
            data: {
              vehicleSlug: "preparing-car",
              trimId: "",
              trimName: "",
              trimPrice: 40_000_000,
              optionsTotalPrice: 0,
              colorDelta: 0,
              totalVehiclePrice: 40_000_000,
              contractMonths: 60,
              annualMileage: 20000,
              contractType: "반납형",
              customerType: "individual",
              scenarios: {},
              requiresConsultation: true,
            },
          });
        }
        return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
      })
    );

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    const submit = await screen.findByRole("button", { name: "상담 필요 견적 확인하기" });
    expect(submit).toBeEnabled();

    fireEvent.click(submit);

    await screen.findByText("이 차량은 별도 상담이 필요합니다");
    expect(screen.getByText("준비중 차량")).toBeInTheDocument();
    expect(screen.getByText("월 납입금")).toBeInTheDocument();
    expect(screen.getByText("별도 상담 필요")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "선택 조건으로 상담 요청하기" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("트림을 선택하세요")).not.toBeInTheDocument();
    });
  });

  it("keeps the review-request button and opens a coming-soon contact modal", async () => {
    writeCalculatedRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    const apply = await screen.findByRole("button", { name: "심사 요청하기" });
    fireEvent.click(apply);

    expect(
      screen.getByRole("dialog", { name: "서류 심사 서비스는 준비 중이에요" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /1688-8479 전화 걸기/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "상담하기" }).length).toBeGreaterThanOrEqual(1);
  });

  it("keeps the range warning readable on narrow Korean layouts", async () => {
    writeCalculatedRestore();
    const storedRestore = window.localStorage.getItem("quote_image_restore");
    if (!storedRestore) throw new Error("quote restore fixture is missing");
    const restore = JSON.parse(storedRestore) as {
      quoteResult: {
        scenarios: {
          standard: {
            rangeExceeded?: boolean;
          };
        };
      };
    };
    restore.quoteResult.scenarios.standard.rangeExceeded = true;
    window.localStorage.setItem("quote_image_restore", JSON.stringify(restore));
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    const warning = await screen.findByText(/선택하신 옵션 조합으로 차량가가/);
    expect(warning).toHaveClass("break-keep");
  });

  it("pins the Kakao delivery action to a viewport-fixed bar on the result step", async () => {
    writeCalculatedRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    const deliveryBar = await screen.findByRole("region", { name: "견적서 받기" });
    expect(deliveryBar.className).toMatch(/\bfixed\b/);
    expect(deliveryBar.className).toMatch(/\bbottom-0\b/);
    expect(deliveryBar.className).toMatch(/\bpx-5\b/);
    expect(deliveryBar.className.split(/\s+/)).toContain(DOCK_BOTTOM_PADDING_CLASS);
    expect(deliveryBar.className).not.toMatch(/\bborder-t\b/);
    expect(deliveryBar.className).not.toMatch(/bg-surface/);
    expect(deliveryBar.className).not.toMatch(/backdrop-blur/);
    expect(
      screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
    ).toBe(deliveryBar.querySelector("button"));
    expect(screen.getByRole("button", { name: "조건 다시 설정하기" })).toBeInTheDocument();
    expect(deliveryBar).not.toHaveTextContent("조건 다시 설정하기");
    expect(deliveryBar).not.toHaveTextContent("심사 요청하기");
    expect(deliveryBar.previousElementSibling?.className).toMatch(
      /pb-\[calc\(16rem\+env\(safe-area-inset-bottom,0px\)\)\]/,
    );
  });

  it("starts Kakao consent from the successful-result delivery action", async () => {
    // Given: a calculated quote has been restored and normal render fetches are available
    writeCalculatedRestore();
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    // When: the customer opens the send action
    render(<QuoteClientPageV2 vehicles={vehicles} />);
    const deliveryButton = await screen.findByRole("button", {
      name: "카카오톡으로 견적서 받기",
    });
    expect(screen.getByRole("button", { name: "심사 요청하기" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "상담하기" })).toBeInTheDocument();
    const deliveryBar = screen.getByRole("region", { name: "견적서 받기" });
    expect(deliveryBar.className).toMatch(/\bfixed\b/);
    expect(deliveryBar.className).toMatch(/\bbottom-0\b/);
    expect(deliveryButton).toBe(deliveryBar.querySelector("button"));
    fireEvent.click(deliveryButton);

    // Then: anonymous users see the delivery login gate first; Kakao consent starts
    // only from the gate CTA, and no delivery request has been made yet.
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    expect(supabaseMock.signInWithOAuth).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" })
    );
    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
    const requestedUrls = fetchMock.mock.calls.map(([input]) => input.toString());
    expect(requestedUrls.some((url) => url === "/api/quote/image")).toBe(false);
    expect(requestedUrls.some((url) => url === "/api/quote/deliver")).toBe(false);
  });

  it("saves the exact quote before delivering its server-side identifier to Kakao", async () => {
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({
          success: true,
          data: { deliveryId: "delivery-1" },
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      );
    });

    const saveIndex = fetchMock.mock.calls.findIndex(([input]) => input.toString() === "/api/quote/save");
    const deliverIndex = fetchMock.mock.calls.findIndex(([input]) => input.toString() === "/api/quote/deliver");
    expect(saveIndex).toBeGreaterThanOrEqual(0);
    expect(deliverIndex).toBeGreaterThan(saveIndex);

    const deliverCall = fetchMock.mock.calls[deliverIndex];
    expect(JSON.parse(String(deliverCall?.[1]?.body))).toEqual({
      savedQuoteId: "saved-quote-1",
      sessionId: "saved-session-1",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "카카오톡으로 견적서를 보냈어요"
    );
  });

  it("refreshes a restored anonymous quote before saving and delivering its server-side identifier", async () => {
    writeLockedCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/quote")) {
        return Response.json({
          success: true,
          data: createUnlockedCalculatedQuoteResult(),
        });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({
          success: true,
          data: { deliveryId: "delivery-1" },
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      );
    });

    const quoteIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
    );
    const saveIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input.toString() === "/api/quote/save"
    );
    const deliverIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input.toString() === "/api/quote/deliver"
    );
    expect(quoteIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeGreaterThan(quoteIndex);
    expect(deliverIndex).toBeGreaterThan(saveIndex);

    const deliverBody = JSON.parse(
      String(fetchMock.mock.calls[deliverIndex]?.[1]?.body)
    );
    expect(deliverBody).toEqual({
      savedQuoteId: "saved-quote-1",
      sessionId: "saved-session-1",
    });
  });

  it("requests Kakao consent directly when the stored provider token must be renewed", async () => {
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json(
          {
            error: "카카오톡 전송 권한이 만료되었습니다.",
            code: "KAKAO_REAUTH_REQUIRED",
          },
          { status: 409 }
        );
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" }));

    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
    expect(supabaseMock.signInWithOAuth).toHaveBeenCalledWith({
      provider: "kakao",
      options: expect.objectContaining({
        scopes: expect.stringContaining("talk_message"),
        queryParams: {
          scope: expect.stringContaining("talk_message"),
        },
      }),
    });
    expect(navigationMock.router.push).not.toHaveBeenCalledWith(
      expect.stringContaining("/login?next=")
    );
  });

  // 프로덕션 회귀 방지 — 카카오 자동발송 경로에서도 비회원은 OAuth 직행이 아니라
  // 게이트 모달을 먼저 봐야 한다(채널톡 경로와 동일 정책).
  it("shows the delivery login gate instead of redirecting a guest on the Kakao auto-send path", async () => {
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" }));

    expect(
      await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" })
    ).toBeInTheDocument();
    expect(supabaseMock.signInWithOAuth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/quote/deliver", expect.anything());

    // 모달 CTA 를 눌러야 비로소 카카오 로그인이 시작된다.
    fireEvent.click(
      screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" })
    );
    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
  });

  it("routes quote delivery to Kakao channel add when the Kakao flag is disabled (stopgap)", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "false");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID", "_TestCh");
    // 견적서 수령은 회원 전용 — 채널톡 경로도 로그인 세션이 있어야 진행된다.
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeCalculatedRestore();
    const channelCalls: unknown[][] = [];
    window.ChannelIO = (...args: unknown[]) => {
      channelCalls.push(args);
    };
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/save",
        expect.objectContaining({ method: "POST" })
      );
    });

    // 임시방편: 자동발송(/api/quote/deliver) 대신 안내 모달 → 카카오 채널 대화창으로 유도한다.
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/quote/deliver",
      expect.anything()
    );
    // ① 상담사가 볼 견적 컨텍스트를 채널톡 track 으로 기록
    const trackCall = channelCalls.find(
      (args) => args[0] === "track" && args[1] === "quote_delivery_requested"
    );
    expect(trackCall).toBeDefined();
    // ② 견적 요청 메시지를 클립보드에 복사(붙여넣기 유도)
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("[견적서 요청]"))
    );
    // ③ 바로 이동하지 않고 안내 모달을 띄운다 — 복사 안내를 읽은 뒤 CTA 로 이동.
    const dialog = await screen.findByRole("dialog", {
      name: "견적 요청 메시지를 복사했어요",
    });
    expect(dialog).toHaveTextContent("길게 눌러 붙여넣기");
    expect(openSpy).not.toHaveBeenCalled();

    // ④ 모달 CTA 클릭 → 채널 홈이 아니라 채널 "대화창"(/chat)을 연다.
    //    (클릭 직후 동기 실행 — 팝업 차단 회피를 위해 한 번의 창 열기만 수행)
    fireEvent.click(screen.getByRole("button", { name: "견적서 받으러 가기" }));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      "https://pf.kakao.com/_TestCh/chat",
      "_blank",
      "noopener,noreferrer"
    );
    // CTA 클릭 시 새 제스처에서 한 번 더 복사한다(첫 복사의 활성화 만료 대비).
    expect(writeText).toHaveBeenCalledTimes(2);
    // 모달이 닫히고 완료 안내가 남는다.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "견적 요청 메시지를 복사했어요" })
      ).not.toBeInTheDocument()
    );
    // 붙여넣기 전에는 상담사에게 가지 않았으므로 완료가 아니라 미전송 안내가 남는다.
    expect(screen.getByRole("status")).toHaveTextContent("아직 보내지 않았어요");

    // ⑤ 창을 닫았거나 붙여넣기를 놓쳤을 때 대화창으로 되돌아갈 길을 남긴다.
    fireEvent.click(screen.getByRole("button", { name: "대화창 다시 열기" }));
    expect(openSpy).toHaveBeenCalledTimes(2);
    expect(openSpy).toHaveBeenLastCalledWith(
      "https://pf.kakao.com/_TestCh/chat",
      "_blank",
      "noopener,noreferrer"
    );
    // 다시 열 때도 요청 문구를 새로 복사해 준다.
    expect(writeText).toHaveBeenCalledTimes(3);

    // ⑥ 실제로 보낸 고객은 '보냈어요'로 경고를 닫을 수 있다.
    fireEvent.click(screen.getByRole("button", { name: "보냈어요" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("상담사가 확인 후")
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("아직 보내지 않았어요");
    // 상담사 데스크에도 고객이 전송했다고 남긴다.
    expect(
      channelCalls.find(
        (args) => args[0] === "track" && args[1] === "quote_delivery_sent"
      )
    ).toBeDefined();
  });

  it("gates the channel-talk quote delivery behind login when signed out", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "false");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID", "_TestCh");
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeCalculatedRestore();
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/logs/exploration") {
        return Response.json({ ok: true });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );

    // 로그인 안내 모달만 뜨고, 견적 저장·복사·대화창은 모두 보류된다.
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/quote/save", expect.anything());
    expect(writeText).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "견적 요청 메시지를 복사했어요" })
    ).not.toBeInTheDocument();

    // 게이트 표시가 퍼널 이벤트로 기록된다 (견적 세션 ID 로 QuoteCalcLog 와 조인).
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/logs/exploration",
        expect.objectContaining({ method: "POST" })
      )
    );
    const gateCall = fetchMock.mock.calls.find(
      (call) => call[0] === "/api/logs/exploration"
    );
    const gateBody = JSON.parse(String(gateCall?.[1]?.body));
    expect(gateBody.eventType).toBe("delivery_gate_shown");
    expect(gateBody.sessionId).toBeTruthy();
    expect(gateBody.vehicleId).toBe("vehicle-preparing");
  });

  it("starts Kakao login with a delivery resume marker from the login gate", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "false");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID", "_TestCh");
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    writeCalculatedRestore();
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      if (input.toString() === "/api/logs/exploration") {
        return Response.json({ ok: true });
      }
      return Response.json({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    fireEvent.click(screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" }));

    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalled());
    const redirectTo = supabaseMock.signInWithOAuth.mock.calls.at(-1)?.[0]?.options
      ?.redirectTo as string;
    // 로그인 후 돌아와 견적 요청을 이어가도록 복귀 주소에 표식을 남긴다.
    const next = decodeURIComponent(new URL(redirectTo).searchParams.get("next") ?? "");
    expect(next).toContain("/quote");
    expect(next).toContain("deliver=1");
    expect(next).toContain("restore=1");

    // 게이트 → 로그인 클릭 전환도 같은 견적 세션으로 기록된다.
    const eventTypes = fetchMock.mock.calls
      .filter((call) => call[0] === "/api/logs/exploration")
      .map((call) => JSON.parse(String(call[1]?.body)).eventType);
    expect(eventTypes).toContain("delivery_gate_shown");
    expect(eventTypes).toContain("delivery_gate_login_click");
  });

  it("resumes the delivery guide after returning from login and never auto-opens the chat", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "false");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID", "_TestCh");
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    writeCalculatedRestore();
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    // 버튼을 다시 누르지 않아도 안내 모달까지 자동으로 이어진다.
    await screen.findByRole("dialog", { name: "견적 요청 메시지를 복사했어요" });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/save",
        expect.objectContaining({ method: "POST" })
      )
    );
    // 팝업 차단 때문에 대화창은 CTA 클릭으로만 연다.
    expect(openSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" })
    ).not.toBeInTheDocument();
    // 로그인 상태 복귀에서는 게이트 이벤트가 기록되지 않는다.
    const gateEvents = fetchMock.mock.calls
      .filter((call) => call[0] === "/api/logs/exploration")
      .map((call) => JSON.parse(String(call[1]?.body)).eventType)
      .filter((t) => typeof t === "string" && t.startsWith("delivery_gate"));
    expect(gateEvents).toHaveLength(0);
  });

  it("keeps the same quote session across the gate login round trip", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_SYNC", "false");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID", "_TestCh");
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    writeCalculatedRestore();
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/logs/exploration") {
        return Response.json({ ok: true });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    // ① 비회원 마운트 — 게이트 표시 → 카카오 로그인 클릭
    const first = render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    fireEvent.click(screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" }));
    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalled());

    const loginClickCall = fetchMock.mock.calls.find(
      (call) =>
        call[0] === "/api/logs/exploration" &&
        JSON.parse(String(call[1]?.body)).eventType === "delivery_gate_login_click"
    );
    const gateSessionId = JSON.parse(String(loginClickCall?.[1]?.body)).sessionId;
    // 왕복 복귀에서 이어받을 세션이 보관된다.
    expect(window.localStorage.getItem("imd_delivery_gate_session")).toBe(gateSessionId);
    first.unmount();

    // ② 로그인 완료 후 deliver=1 로 복귀 — 같은 세션으로 이어져야 한다.
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    render(<QuoteClientPageV2 vehicles={vehicles} />);

    // 자동 재개가 견적 저장까지 도달하고, 그 세션이 게이트 시점과 같다.
    await screen.findByRole("dialog", { name: "견적 요청 메시지를 복사했어요" });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/save",
        expect.objectContaining({ method: "POST" })
      )
    );
    const saveCall = fetchMock.mock.calls.find((call) => call[0] === "/api/quote/save");
    expect(JSON.parse(String(saveCall?.[1]?.body)).sessionId).toBe(gateSessionId);
    // 세션 키는 소비되어 남아 있지 않는다.
    expect(window.localStorage.getItem("imd_delivery_gate_session")).toBeNull();
  });

  it("does not route to verification when the review-request coming-soon modal is opened", async () => {
    writeCalculatedRestore();
    const fetchMock = createFetchMock(500);
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    fireEvent.click(await screen.findByRole("button", { name: "심사 요청하기" }));
    expect(
      screen.getByRole("dialog", { name: "서류 심사 서비스는 준비 중이에요" }),
    ).toBeInTheDocument();
    expect(navigationMock.router.push).not.toHaveBeenCalled();
    const requestedUrls = fetchMock.mock.calls.map(([input]) => input.toString());
    expect(requestedUrls.some((url) => url === "/api/quote/save")).toBe(false);
    expect(requestedUrls.some((url) => url === "/api/quote/deliver")).toBe(false);
  });

  it("keeps the AI source through the member-gate login round trip", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&source=AI"
    );
    writeCalculatedRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    fireEvent.click(await screen.findByRole("button", {
      name: /보증금·선납금 없이 시작/,
    }));
    fireEvent.click(await screen.findByRole("button", { name: "카카오로 3초 로그인" }));

    expect(navigationMock.router.push).toHaveBeenCalledWith(
      expect.stringContaining("source%3DAI")
    );
  });

  it("prefills the exact AI-recommended trim and quote contract", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&source=AI&trim=trim-ai&productType=장기렌트&contractMonths=60&annualMileage=20000"
    );
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors")) {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/trims")) {
        return Response.json({
          success: true,
          data: [
            {
              id: "trim-default",
              name: "기본 트림",
              price: 38_000_000,
              discountPrice: null,
              evSubsidy: null,
              engineType: "GASOLINE",
              fuelEfficiency: 10,
              isDefault: true,
              specs: null,
              options: [],
              rules: [],
              lineupId: null,
              lineup: null,
              availableProducts: ["장기렌트"],
            },
            {
              id: "trim-ai",
              name: "AI 추천 트림",
              price: 40_000_000,
              discountPrice: 39_000_000,
              evSubsidy: null,
              engineType: "HEV",
              fuelEfficiency: 16,
              isDefault: false,
              specs: null,
              options: [],
              rules: [],
              lineupId: null,
              lineup: null,
              availableProducts: [],
            },
          ],
        });
      }
      if (url.endsWith("/quote")) {
        return Response.json({ success: false, error: "request captured" }, { status: 400 });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    fireEvent.click(await screen.findByRole("button", { name: "선택 조건 확인하기" }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([request]) => request.toString().endsWith("/quote"))).toBe(true);
    });
    const quoteCall = fetchMock.mock.calls.find(([request]) => request.toString().endsWith("/quote"));
    expect(JSON.parse(String(quoteCall?.[1]?.body))).toMatchObject({
      trimId: "trim-ai",
      productType: "장기렌트",
      contractMonths: 60,
      annualMileage: 20_000,
      contractType: "반납형",
    });
  });

  it("saves consultation conditions before opening ChannelTalk with the quote id", async () => {
    writeConsultationRestore();
    const channelCalls: unknown[][] = [];
    window.ChannelIO = (...args: unknown[]) => channelCalls.push(args);
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({
            id: "consultation-quote-1",
            sessionId: "consultation-session-1",
            requiresConsultation: true,
            monthlyPayment: 0,
            totalCost: 0,
            pricingStatus: "CONSULTATION_REQUIRED",
          }),
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    fireEvent.click(await screen.findByRole("button", {
      name: "선택 조건으로 상담 요청하기",
    }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/save",
        expect.objectContaining({ method: "POST" })
      );
    });
    const saveCall = fetchMock.mock.calls.find(([input]) => input.toString() === "/api/quote/save");
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      trimId: "trim-preparing",
      productType: "장기렌트",
      contractMonths: 60,
      annualMileage: 20_000,
    });
    expect(channelCalls).toEqual([
      ["track", "quote_consultation_requested", expect.objectContaining({
        quoteId: "consultation-quote-1",
        sessionId: "consultation-session-1",
        trimName: "프리미엄",
      })],
      ["showMessenger"],
    ]);
  });

  it("fires the Google Ads quote-request conversion once per saved quote", async () => {
    writeConsultationRestore();
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID", "AW-18396038759");
    vi.stubEnv(
      "NEXT_PUBLIC_GOOGLE_ADS_QUOTE_REQUEST_LABEL",
      "rWy3CKr3i-QcEOeM9cNE"
    );
    const gtag = vi.fn();
    window.gtag = gtag;
    window.ChannelIO = () => {};
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({
            id: "consultation-quote-1",
            sessionId: "consultation-session-1",
            requiresConsultation: true,
            monthlyPayment: 0,
            totalCost: 0,
            pricingStatus: "CONSULTATION_REQUIRED",
          }),
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    const requestButton = await screen.findByRole("button", {
      name: "선택 조건으로 상담 요청하기",
    });
    fireEvent.click(requestButton);

    await waitFor(() => {
      expect(gtag).toHaveBeenCalledWith("event", "conversion", {
        send_to: "AW-18396038759/rWy3CKr3i-QcEOeM9cNE",
        transaction_id: "consultation-quote-1",
      });
    });

    // 같은 견적을 다시 요청해도 전환은 한 번만 집계돼야 광고 최적화가 왜곡되지 않는다.
    fireEvent.click(requestButton);
    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(
        ([input]) => input.toString() === "/api/quote/save"
      ).length).toBe(2);
    });
    expect(gtag).toHaveBeenCalledTimes(1);
  });

  it("replaces the on-screen monthly payment with the amount persisted by save", async () => {
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/quote") && url !== "/api/quote/save") {
        const flushed = createUnlockedCalculatedQuoteResult();
        flushed.scenarios.standard = {
          ...flushed.scenarios.standard!,
          monthlyPayment: 650_000,
          depositAmount: 4_000_000,
        };
        return Response.json({ success: true, data: flushed });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({
            id: "saved-quote-1",
            sessionId: "saved-session-1",
            monthlyPayment: 640_000,
          }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({
          success: true,
          data: { deliveryId: "delivery-1" },
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    const deliveryButton = await screen.findByRole("button", {
      name: "카카오톡으로 견적서 받기",
    });
    expect(screen.getByText((_, node) => node?.textContent === "65만원")).toBeInTheDocument();
    fireEvent.click(deliveryButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      );
    });
    const quoteIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
    );
    const saveIndex = fetchMock.mock.calls.findIndex(
      ([input]) => input.toString() === "/api/quote/save"
    );
    expect(quoteIndex).toBeGreaterThanOrEqual(0);
    expect(saveIndex).toBeGreaterThan(quoteIndex);
    expect(
      await screen.findByText((_, node) => node?.textContent === "64만원")
    ).toBeInTheDocument();
  });

  it("recalculates with the restored trim, options, and colors while vehicle details are still loading", async () => {
    writeCalculatedRestore();
    const storedRestore = window.localStorage.getItem("quote_image_restore");
    if (!storedRestore) throw new Error("quote restore fixture is missing");
    const restore = JSON.parse(storedRestore) as {
      selectedOptionIds: string[];
      exteriorColorId?: string | null;
      interiorColorId?: string | null;
    };
    restore.selectedOptionIds = ["option-restored"];
    restore.exteriorColorId = "color-ext-restored";
    restore.interiorColorId = "color-int-restored";
    window.localStorage.setItem("quote_image_restore", JSON.stringify(restore));

    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        // 트림/색상 목록이 아직 로드되지 않은 상태를 유지한다.
        return new Promise<Response>(() => {});
      }
      if (url.endsWith("/quote") && url !== "/api/quote/save") {
        return Response.json({ success: true, data: createUnlockedCalculatedQuoteResult() });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({
          success: true,
          data: { deliveryId: "delivery-1" },
        });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      );
    });

    const quoteCall = fetchMock.mock.calls.find(
      ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
    );
    expect(quoteCall).toBeDefined();
    const quoteBody = JSON.parse(String(quoteCall?.[1]?.body));
    expect(quoteBody.trimId).toBe("trim-preparing");
    expect(quoteBody.selectedOptionIds).toEqual(["option-restored"]);
    expect(quoteBody.exteriorColorId).toBe("color-ext-restored");
    expect(quoteBody.interiorColorId).toBe("color-int-restored");

    const saveCall = fetchMock.mock.calls.find(
      ([input]) => input.toString() === "/api/quote/save"
    );
    const saveBody = JSON.parse(String(saveCall?.[1]?.body));
    expect(saveBody.selectedOptionIds).toEqual(["option-restored"]);
    expect(saveBody.exteriorColorId).toBe("color-ext-restored");
    expect(saveBody.interiorColorId).toBe("color-int-restored");
  });
});

describe("QuoteClientPageV2 locked result representation", () => {
  it("shows the public prepay-30 amount instead of 0만원 when the standard slot is locked (old shape)", async () => {
    // 구형 잠금(locked + 0) standard + 공개 aggressive(53만원) — 잠긴 슬롯이
    // 가격으로 그려지면 안 되고, 공개 선납 30% 금액으로 폴백해야 한다.
    writeLockedCalculatedRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(
      await screen.findByText((_, node) => node?.textContent === "53만원")
    ).toBeInTheDocument();
    expect(
      screen.queryByText((_, node) => node?.textContent === "0만원")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("별도 상담 필요")).not.toBeInTheDocument();
  });

  it.each([
    ["old shape locked + 0", 0 as const],
    ["new shape locked + null", null],
  ])(
    "never paints 0만원 and offers the login path when every scenario is locked (%s)",
    async (_label, lockedMonthly) => {
      writeGuestAllLockedRestore(lockedMonthly);
      vi.stubGlobal("fetch", createFetchMock());

      render(<QuoteClientPageV2 vehicles={vehicles} />);

      // 잠금 = 가격 없음 — 0원 배너 대신 로그인 안내가 뜬다.
      expect(
        await screen.findByText("로그인하면 이 조건 월납 확인")
      ).toBeInTheDocument();
      expect(
        screen.queryByText((_, node) => node?.textContent === "0만원")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("별도 상담 필요")).not.toBeInTheDocument();

      // 안내 CTA 는 기존 로그인 모달 퍼널로 이어진다.
      fireEvent.click(
        screen.getByRole("button", { name: "로그인하고 월 납입금 보기" })
      );
      expect(
        await screen.findByRole("dialog", { name: "지금 로그인하면" })
      ).toBeInTheDocument();
      expect(
        screen.getByText("보증금·선납금 비율 자유 조절")
      ).toBeInTheDocument();
    }
  );
});

describe("QuoteClientPageV2 result first screen", () => {
  it("shows the prepay 30% amount with the 있음 toggle selected on first entry", async () => {
    writeFirstEntryRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(await screen.findByText((_, node) => node?.textContent === "53만원")).toBeInTheDocument();
    expect(screen.queryByText((_, node) => node?.textContent === "70만원")).not.toBeInTheDocument();

    const hasInitial = screen.getByRole("button", { name: /초기 납부로 월납입 절감/ });
    const hasNone = screen.getByRole("button", { name: /보증금·선납금 없이 시작/ });
    expect(hasInitial.compareDocumentPosition(hasNone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hasInitial.className).toMatch(/ring-brand/);
    expect(screen.getAllByRole("button", { name: "30%" }).length).toBeGreaterThan(0);
  });

  it("opens the login modal and keeps the amount when a guest clicks 없음 or another rate", async () => {
    writeFirstEntryRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByText((_, node) => node?.textContent === "53만원");

    fireEvent.click(screen.getByRole("button", { name: /보증금·선납금 없이 시작/ }));
    expect(await screen.findByRole("dialog", { name: "지금 로그인하면" })).toBeInTheDocument();
    expect(screen.getByText("보증금·선납금 비율 자유 조절")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "53만원")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
    expect(await screen.findByRole("dialog", { name: "지금 로그인하면" })).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "53만원")).toBeInTheDocument();
  });

  it("lets a member switch to no-deposit after the first prepay-30 screen", async () => {
    writeFirstEntryRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByText((_, node) => node?.textContent === "53만원");
    await waitFor(() => expect(supabaseMock.getUser).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /보증금·선납금 없이 시작/ }));
    expect(screen.queryByRole("dialog", { name: "지금 로그인하면" })).not.toBeInTheDocument();
    expect(await screen.findByText((_, node) => node?.textContent === "70만원")).toBeInTheDocument();
  });

  // 고객 리포트 재현: 비회원 선납 30% 화면 → 로그인 → 없음(무보증) 선택.
  // 복원된 quoteResult 가 아직 비회원 게이트 응답(standard 잠금)이어도,
  // 회원의 없음 선택은 잠긴 기준을 되살려 선납 30% 금액에 머물면 안 되고
  // 실제 무보증 월납으로 이어져야 한다.
  it("shows the real no-deposit monthly when a member selects 없음 on a restored guest-gated result", async () => {
    writeGuestGatedFirstEntryRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByText((_, node) => node?.textContent === "53만원");
    await waitFor(() => expect(supabaseMock.getUser).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /보증금·선납금 없이 시작/ }));

    // 회원이므로 로그인 모달 없이 진행된다.
    expect(
      screen.queryByRole("dialog", { name: "지금 로그인하면" })
    ).not.toBeInTheDocument();
    // 잔존한 선납 30% 금액(53만원)이 아니라 실제 무보증 월납(70만원)이 떠야 한다.
    expect(
      await screen.findByText(
        (_, node) => node?.textContent === "70만원",
        undefined,
        { timeout: 3000 }
      )
    ).toBeInTheDocument();
    // 잠금/무가격이 0원으로 그려지는 회귀도 금지.
    expect(
      screen.queryByText((_, node) => node?.textContent === "0만원")
    ).not.toBeInTheDocument();
  });

  it("recalculates a restored guest-gated result as the member right after login", async () => {
    writeGuestGatedFirstEntryRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByText((_, node) => node?.textContent === "53만원");

    // 로그인 복귀만으로 회원 자격 재계산이 나간다 — 없음을 누르기 전에
    // 잠긴 standard 가 실제 금액으로 대체되어야 한다.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/vehicles/preparing-car/quote",
        expect.objectContaining({ method: "POST" })
      );
    });
    const quoteCall = fetchMock.mock.calls.find(
      ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
    );
    const quoteBody = JSON.parse(String(quoteCall?.[1]?.body));
    // 기준(무보증) 조건으로 다시 계산한다 — 커스텀 비율 없이.
    expect(quoteBody.trimId).toBe("trim-preparing");
    expect(quoteBody.customDepositRate).toBeUndefined();
    expect(quoteBody.customPrepayRate).toBeUndefined();
    // 화면은 여전히 선택된 선납 30% 조건의 공개 금액을 유지한다.
    expect(
      screen.getByText((_, node) => node?.textContent === "53만원")
    ).toBeInTheDocument();
  });

  it("defaults a fresh calculate result to prepay 30% and initial cost mode", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&trim=trim-preparing"
    );
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors")) {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/trims")) {
        return Response.json({
          success: true,
          data: [
            {
              id: "trim-preparing",
              name: "프리미엄",
              price: 40_000_000,
              discountPrice: null,
              evSubsidy: null,
              engineType: "GASOLINE",
              fuelEfficiency: 10,
              isDefault: true,
              specs: null,
              options: [],
              rules: [],
              lineupId: null,
              lineup: null,
              availableProducts: ["장기렌트"],
            },
          ],
        });
      }
      if (url.endsWith("/quote")) {
        return Response.json({ success: true, data: createUnlockedCalculatedQuoteResult() });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "월 납입금 확인하기" }));

    expect(await screen.findByText((_, node) => node?.textContent === "53만원")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /초기 납부로 월납입 절감/ }).className).toMatch(/ring-brand/);
    expect(screen.getAllByRole("button", { name: "30%" }).length).toBeGreaterThan(0);
  });
});

function expectSelectedChip(name: string) {
  expect(screen.getByRole("button", { name }).className).toMatch(/ring-brand/);
}

async function renderRestoredQuoteResult() {
  window.history.replaceState({ page: "car" }, "", "/cars/preparing-car");
  window.history.pushState(
    { page: "quote" },
    "",
    "/quote?vehicle=preparing-car&customerType=individual&restore=1",
  );
  writeCalculatedRestore();
  vi.stubGlobal("fetch", createFetchMock());
  render(<QuoteClientPageV2 vehicles={vehicles} />);
  await screen.findByRole("button", { name: "조건 다시 설정하기" });
  await waitFor(() => {
    expect(window.history.state).toEqual(expect.objectContaining({ imdQuoteResult: true }));
  });
}

async function expectReturnedToStep2(conditions: {
  readonly months: string;
  readonly mileage: string;
  readonly product: string;
}) {
  await waitFor(() => {
    expect(screen.getAllByText("조건 설정").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "조건 다시 설정하기" })).not.toBeInTheDocument();
  });
  expect(navigationMock.router.back).not.toHaveBeenCalled();
  expect(navigationMock.router.push).not.toHaveBeenCalledWith("/cars/preparing-car");
  expectSelectedChip(conditions.months);
  expectSelectedChip(conditions.mileage);
  expectSelectedChip(conditions.product);
  expect(window.history.state).not.toEqual(expect.objectContaining({ imdQuoteResult: true }));
}

describe("QuoteClientPageV2 result back navigation", () => {
  it("returns to step 2 from 「조건 다시 설정하기」 and keeps the chosen conditions", async () => {
    await renderRestoredQuoteResult();

    fireEvent.click(screen.getByRole("button", { name: "조건 다시 설정하기" }));

    await expectReturnedToStep2({ months: "60개월", mileage: "연 2만km", product: "장기렌트" });
  });

  it("returns to step 2 from the header back button and does not call router.back", async () => {
    await renderRestoredQuoteResult();

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    await expectReturnedToStep2({ months: "60개월", mileage: "연 2만km", product: "장기렌트" });
  });

  it("returns to step 2 from a popstate (system back) without leaving the page", async () => {
    await renderRestoredQuoteResult();

    act(() => {
      window.history.back();
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    await expectReturnedToStep2({ months: "60개월", mileage: "연 2만km", product: "장기렌트" });
  });

  it("keeps user-changed period and mileage after calculating and resetting conditions", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&trim=trim-preparing",
    );
    window.history.replaceState({ page: "car" }, "", "/cars/preparing-car");
    window.history.pushState(
      { page: "quote" },
      "",
      "/quote?vehicle=preparing-car&customerType=individual&trim=trim-preparing",
    );
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors")) {
        return Response.json({ success: true, data: [] });
      }
      if (url.endsWith("/trims")) {
        return Response.json({
          success: true,
          data: [
            {
              id: "trim-preparing",
              name: "프리미엄",
              price: 40_000_000,
              discountPrice: null,
              evSubsidy: null,
              engineType: "GASOLINE",
              fuelEfficiency: 10,
              isDefault: true,
              specs: null,
              options: [],
              rules: [],
              lineupId: null,
              lineup: null,
              availableProducts: ["장기렌트"],
            },
          ],
        });
      }
      if (url.endsWith("/quote")) {
        return Response.json({ success: true, data: createUnlockedCalculatedQuoteResult() });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(await screen.findByRole("button", { name: "48개월" }));
    fireEvent.click(screen.getByRole("button", { name: "연 3만km" }));
    fireEvent.click(await screen.findByRole("button", { name: "월 납입금 확인하기" }));
    await screen.findByRole("button", { name: "조건 다시 설정하기" });
    await waitFor(() => {
      expect(window.history.state).toEqual(expect.objectContaining({ imdQuoteResult: true }));
    });

    fireEvent.click(screen.getByRole("button", { name: "조건 다시 설정하기" }));

    await expectReturnedToStep2({ months: "48개월", mileage: "연 3만km", product: "장기렌트" });
  });

  it("does not push a second result history entry when already on the result step", async () => {
    window.history.replaceState({ page: "car" }, "", "/cars/preparing-car");
    window.history.pushState(
      { page: "quote" },
      "",
      "/quote?vehicle=preparing-car&customerType=individual&restore=1",
    );
    const lengthBefore = window.history.length;
    writeCalculatedRestore();
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByRole("button", { name: "조건 다시 설정하기" });
    await waitFor(() => {
      expect(window.history.state).toEqual(expect.objectContaining({ imdQuoteResult: true }));
    });

    expect(window.history.length).toBe(lengthBefore + 1);

    fireEvent.click(screen.getByRole("button", { name: "조건 다시 설정하기" }));
    await expectReturnedToStep2({ months: "60개월", mileage: "연 2만km", product: "장기렌트" });

    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getAllByText("조건 설정").length).toBeGreaterThan(0);
    expect(navigationMock.router.back).not.toHaveBeenCalled();
  });

  it("sends step 2 header back to the vehicle detail via router.back", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual",
    );
    window.history.replaceState({ page: "car" }, "", "/cars/preparing-car");
    window.history.pushState(
      { page: "quote" },
      "",
      "/quote?vehicle=preparing-car&customerType=individual",
    );
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findAllByText("조건 설정");

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(navigationMock.router.back).toHaveBeenCalledTimes(1);
    expect(navigationMock.router.push).not.toHaveBeenCalled();
    expect(screen.getAllByText("조건 설정").length).toBeGreaterThan(0);
  });

  it("falls back to the vehicle detail when step 1 has no history to go back to", async () => {
    navigationMock.searchParams = new URLSearchParams("vehicle=preparing-car");
    vi.spyOn(window.history, "length", "get").mockReturnValue(1);
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findAllByText("고객 유형");

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(navigationMock.router.push).toHaveBeenCalledWith("/cars/preparing-car");
    expect(navigationMock.router.back).not.toHaveBeenCalled();
  });
});

// 슬라이더(초기비용 비율) 재계산이 실패하면, 화면에 남은 금액은 새 조건이 아니라
// 직전 조건 금액이다. 조용히 넘어가면 고객이 잘못된 금액을 새 조건 금액으로 오인한다.
describe("QuoteClientPageV2 slider recalculation failure", () => {
  it("surfaces a retryable error, keeps the last successful amount, and clears the spinner", async () => {
    // 디바운스(500ms)만 결정론화한다 — 애니메이션/rAF 는 실시간 그대로 둔다.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      writeCalculatedRestore();
      supabaseMock.getUser.mockResolvedValue({
        data: { user: { id: "supabase-user-1" } },
      });
      let failRecalculation = false;
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >(async (input) => {
        const url = input.toString();
        if (url.endsWith("/colors") || url.endsWith("/trims")) {
          return Response.json({ success: true, data: [] });
        }
        if (url === "/api/vehicles/preparing-car/quote") {
          if (failRecalculation) {
            return Response.json(
              { success: false, error: "recalculation failed" },
              { status: 500 }
            );
          }
          return Response.json({
            success: true,
            data: createUnlockedCalculatedQuoteResult(),
          });
        }
        return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<QuoteClientPageV2 vehicles={vehicles} />);
      // 복원 직후 보증금 10% 재계산이 성공해 70만원이 마지막 성공 금액이 된다.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(
        screen.getByText((_, node) => node?.textContent === "70만원")
      ).toBeInTheDocument();
      const successfulRecalculations = fetchMock.mock.calls.filter(
        ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
      ).length;

      // 고객이 슬라이더(프리셋 20%)를 옮겼는데 서버가 500 을 돌려준다.
      failRecalculation = true;
      fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(
        fetchMock.mock.calls.filter(
          ([input]) => input.toString() === "/api/vehicles/preparing-car/quote"
        ).length
      ).toBe(successfulRecalculations + 1);
      // ① 실패를 화면에 알린다
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("다시 계산하지 못했어요");
      // ② 재시도 경로를 남긴다
      expect(screen.getByRole("button", { name: "다시 계산하기" })).toBeInTheDocument();
      // ③ 직전 성공 금액을 유지한다(0원·빈 금액으로 무너지지 않는다)
      expect(
        screen.getByText((_, node) => node?.textContent === "70만원")
      ).toBeInTheDocument();
      // ④ 스피너는 해제된다 — 초기비용 패널의 상시 노드 1개만 남는다.
      expect(screen.getAllByText("재계산 중…")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // 네트워크 자체가 끊긴 경우 — 디바운스 타이머에서 미처리 rejection 을 남기지 않고
  // 같은 안내로 표면화한다.
  it("surfaces a network failure from the debounced recalculation without an unhandled rejection", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      writeCalculatedRestore();
      supabaseMock.getUser.mockResolvedValue({
        data: { user: { id: "supabase-user-1" } },
      });
      let failRecalculation = false;
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >(async (input) => {
        const url = input.toString();
        if (url.endsWith("/colors") || url.endsWith("/trims")) {
          return Response.json({ success: true, data: [] });
        }
        if (url === "/api/vehicles/preparing-car/quote") {
          if (failRecalculation) throw new TypeError("Failed to fetch");
          return Response.json({
            success: true,
            data: createUnlockedCalculatedQuoteResult(),
          });
        }
        return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<QuoteClientPageV2 vehicles={vehicles} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      failRecalculation = true;
      fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(screen.getByRole("alert")).toHaveTextContent("다시 계산하지 못했어요");
      expect(screen.getAllByText("재계산 중…")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the failed recalculation and restores the amount for the new condition", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      writeCalculatedRestore();
      supabaseMock.getUser.mockResolvedValue({
        data: { user: { id: "supabase-user-1" } },
      });
      let failRecalculation = false;
      const fetchMock = vi.fn<
        (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      >(async (input) => {
        const url = input.toString();
        if (url.endsWith("/colors") || url.endsWith("/trims")) {
          return Response.json({ success: true, data: [] });
        }
        if (url === "/api/vehicles/preparing-car/quote") {
          if (failRecalculation) {
            return Response.json(
              { success: false, error: "recalculation failed" },
              { status: 500 }
            );
          }
          const data = createUnlockedCalculatedQuoteResult();
          return Response.json({
            success: true,
            data: {
              ...data,
              scenarios: {
                ...data.scenarios,
                standard: { ...data.scenarios.standard!, monthlyPayment: 660_000 },
              },
            },
          });
        }
        return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<QuoteClientPageV2 vehicles={vehicles} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      failRecalculation = true;
      fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.getByRole("alert")).toHaveTextContent("다시 계산하지 못했어요");

      failRecalculation = false;
      fireEvent.click(screen.getByRole("button", { name: "다시 계산하기" }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByText((_, node) => node?.textContent === "66만원")
      ).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

// 카카오 동의(왕복) 흐름은 복귀 URL 에 표식을 남기지 않으면 저장본을 읽지 않아
// 고객이 1단계부터 다시 시작하게 된다.
describe("QuoteClientPageV2 kakao consent round trip", () => {
  it("carries restore and delivery markers into the Kakao consent redirect", async () => {
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );

    // 비회원은 게이트 모달을 먼저 보고, CTA 클릭으로 카카오 동의 왕복을 시작한다.
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    fireEvent.click(
      screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" })
    );

    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
    const redirectTo =
      supabaseMock.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo ?? "";
    const next = new URL(redirectTo).searchParams.get("next") ?? "";
    expect(next.startsWith("/quote")).toBe(true);
    expect(new URLSearchParams(next.split("?")[1] ?? "").get("restore")).toBe("1");
    expect(new URLSearchParams(next.split("?")[1] ?? "").get("deliver")).toBe("1");
    // 왕복 뒤에도 같은 견적 세션으로 이어지도록 보관한다.
    expect(window.localStorage.getItem("imd_delivery_gate_session")).toBeTruthy();
  });

  it("resumes the saved quote and the delivery intent after returning from Kakao", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/vehicles/preparing-car/quote") {
        return Response.json({
          success: true,
          data: createUnlockedCalculatedQuoteResult(),
        });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({ id: "saved-quote-1", sessionId: "saved-session-1" }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({ success: true, data: { deliveryId: "delivery-1" } });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    // 1단계로 초기화되지 않고 저장된 견적(3단계)이 복원된다.
    expect(
      await screen.findByRole("button", { name: "조건 다시 설정하기" })
    ).toBeInTheDocument();
    // 전달 의도도 이어져 자동으로 전송이 완료된다.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      )
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "카카오톡으로 견적서를 보냈어요"
    );
  });

  // 동의창에서 취소하고 돌아온 고객 — 견적은 살아 있어야 하고, 로그인 루프나
  // 무단 전송(저장/발송)이 일어나면 안 된다.
  it("keeps the restored quote without delivering when the consent was cancelled", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(
      await screen.findByRole("button", { name: "조건 다시 설정하기" })
    ).toBeInTheDocument();
    await waitFor(() => expect(supabaseMock.getUser).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalledWith("/api/quote/save", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/quote/deliver", expect.anything());
    expect(supabaseMock.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("falls back to step 1 with guidance when the restore snapshot is missing", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&restore=1&deliver=1"
    );
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect((await screen.findAllByText("고객 유형")).length).toBeGreaterThan(0);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "이전 견적 정보를 불러오지 못했어요"
    );
  });
});

// ── 자동 재개(deliver=1) 안전장치 ─────────────────────────────────
// OAuth 왕복은 페이지 전체 이동이라 useRef 가드가 회차마다 초기화된다.
// 자동 재개가 실패(409 재동의 요구)로 다시 동의창으로 나가면 왕복이 무한 반복되고,
// 회차마다 견적 저장(DB 쓰기)까지 발생한다.
describe("QuoteClientPageV2 delivery auto-resume guard", () => {
  type QuoteFetchMock = ReturnType<
    typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>
  >;

  function autoResumeFetchMock(
    options: { readonly deliverStatus?: number } = {}
  ): QuoteFetchMock {
    const deliverStatus = options.deliverStatus ?? 200;
    return vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/logs/exploration") {
        return Response.json({ ok: true });
      }
      if (url === "/api/vehicles/preparing-car/quote") {
        return Response.json({
          success: true,
          data: createUnlockedCalculatedQuoteResult(),
        });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({
            id: "saved-quote-1",
            sessionId: "saved-session-1",
          }),
        });
      }
      if (url === "/api/quote/deliver") {
        return deliverStatus === 200
          ? Response.json({ success: true, data: { deliveryId: "delivery-1" } })
          : Response.json(
              {
                error: "카카오톡 전송 권한이 만료되었습니다. 다시 로그인해 주세요.",
                code: "KAKAO_REAUTH_REQUIRED",
              },
              { status: deliverStatus }
            );
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
  }

  function countRequests(fetchMock: QuoteFetchMock, url: string): number {
    return fetchMock.mock.calls.filter(([input]) => input.toString() === url).length;
  }

  // 보류된 fetch 체인(전부 즉시 resolve)을 매크로태스크 경계에서 모두 흘려보낸다.
  async function drainPendingWork(): Promise<void> {
    for (let i = 0; i < 2; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  it("stops at guidance instead of re-entering Kakao consent when the auto resume needs re-auth", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = autoResumeFetchMock({ deliverStatus: 409 });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/quote/deliver",
        expect.objectContaining({ method: "POST" })
      )
    );
    await drainPendingWork();

    // 클릭 0회로 다시 동의창에 나가면 복귀 → 자동 재개 → 409 → 동의창… 무한 왕복이 된다.
    expect(supabaseMock.signInWithOAuth).not.toHaveBeenCalled();
    // 대신 사용자에게 무엇을 해야 하는지 알린다.
    expect(await screen.findByText(/다시 눌러 동의해 주세요/)).toBeInTheDocument();
    // 수동 재시도 경로는 그대로 남는다.
    expect(
      screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
    ).toBeInTheDocument();
    // 저장(DB 쓰기)·전송도 회차마다 반복되지 않는다.
    expect(countRequests(fetchMock, "/api/quote/deliver")).toBe(1);
    expect(countRequests(fetchMock, "/api/quote/save")).toBe(1);
  });

  it("does not auto-resume the delivery twice in the same browser session", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const fetchMock = autoResumeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = render(<QuoteClientPageV2 vehicles={vehicles} />);
    expect(await screen.findByText(/카카오톡으로 견적서를 보냈어요/)).toBeInTheDocument();
    first.unmount();

    // 같은 탭에서 다시 진입(새로고침·뒤로가기) — useRef 가드는 초기화되지만
    // 재전송은 없어야 한다. 페이지 이동을 견디는 저장소가 차단막이다.
    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByRole("button", { name: "조건 다시 설정하기" });
    await drainPendingWork();

    expect(countRequests(fetchMock, "/api/quote/deliver")).toBe(1);
    expect(countRequests(fetchMock, "/api/quote/save")).toBe(1);
  });

  // 마커 생성(동의 리다이렉트)과 소비(복귀 자동 재개)를 한 테스트로 잇는다 —
  // 두 단계를 수기 URL 로 끊어두면 마커 누락 회귀를 잡지 못한다.
  it("carries the consent redirect markers into the auto resume and delivers exactly once", async () => {
    window.history.replaceState(
      {},
      "",
      "/quote?vehicle=preparing-car&customerType=individual&restore=1"
    );
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({ data: { user: null } });
    const fetchMock = autoResumeFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const guest = render(<QuoteClientPageV2 vehicles={vehicles} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "카카오톡으로 견적서 받기" })
    );
    // 게이트 모달 CTA 를 거쳐야 동의 리다이렉트가 시작된다.
    await screen.findByRole("dialog", { name: "카톡으로 견적서 보내드릴게요" });
    fireEvent.click(
      screen.getByRole("button", { name: "카카오로 3초 로그인하고 견적서 받기" })
    );
    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
    const redirectTo =
      supabaseMock.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo ?? "";
    const next = new URL(redirectTo).searchParams.get("next") ?? "";
    // 비회원 단계에서는 저장·전송이 없다.
    expect(countRequests(fetchMock, "/api/quote/save")).toBe(0);
    guest.unmount();

    // 카카오가 돌려보낸 next 그대로 재진입한다(수기 URL 금지).
    navigationMock.searchParams = new URLSearchParams(next.split("?")[1] ?? "");
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    render(<QuoteClientPageV2 vehicles={vehicles} />);

    // 견적(3단계)과 전달 의도가 모두 복원된다.
    expect(
      await screen.findByRole("button", { name: "조건 다시 설정하기" })
    ).toBeInTheDocument();
    expect(await screen.findByText(/카카오톡으로 견적서를 보냈어요/)).toBeInTheDocument();
    await drainPendingWork();
    expect(countRequests(fetchMock, "/api/quote/deliver")).toBe(1);
  });

  // 자동 재개는 막히지만, 사용자가 직접 누른 전송은 기존대로 동의 흐름을 탄다 —
  // 수동/자동 구분이 실제 복구 여정에서 유지되는지 확인한다.
  it("recovers through the manual consent round trip after the auto resume was stopped", async () => {
    let deliverStatus = 409;
    const baseFetchMock = autoResumeFetchMock();
    // autoResumeFetchMock 는 생성 시점 상태를 고정하므로 동적 상태로 한 번 감싼다.
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input, init) => {
      const url = input.toString();
      if (url === "/api/quote/deliver") {
        return deliverStatus === 200
          ? Response.json({ success: true, data: { deliveryId: "delivery-1" } })
          : Response.json(
              {
                error: "카카오톡 전송 권한이 만료되었습니다. 다시 로그인해 주세요.",
                code: "KAKAO_REAUTH_REQUIRED",
              },
              { status: deliverStatus }
            );
      }
      return baseFetchMock.getMockImplementation()!(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);

    // ① 자동 재개 → 409 → 안내로 멈춘다(동의창 재진입 금지).
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&restore=1&deliver=1"
    );
    writeCalculatedRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    const first = render(<QuoteClientPageV2 vehicles={vehicles} />);
    await waitFor(() =>
      expect(screen.getByText(/다시 눌러 동의해 주세요/)).toBeInTheDocument()
    );
    expect(supabaseMock.signInWithOAuth).not.toHaveBeenCalled();

    // ② 사용자가 직접 누른다 — 재동의 왕복은 그대로 간다.
    fireEvent.click(screen.getByRole("button", { name: "카카오톡으로 견적서 받기" }));
    await waitFor(() => expect(supabaseMock.signInWithOAuth).toHaveBeenCalledTimes(1));
    const redirectTo =
      supabaseMock.signInWithOAuth.mock.calls[0]?.[0]?.options?.redirectTo ?? "";
    const next = new URL(redirectTo).searchParams.get("next") ?? "";
    first.unmount();

    // ③ 동의 완료 복귀 — 이 왕복은 사용자 제스처로 나간 것이므로 자동 재개가 이어진다.
    deliverStatus = 200;
    navigationMock.searchParams = new URLSearchParams(next.split("?")[1] ?? "");
    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(await screen.findByText(/카카오톡으로 견적서를 보냈어요/)).toBeInTheDocument();
    await drainPendingWork();
    expect(countRequests(fetchMock, "/api/quote/deliver")).toBe(3);
  });

  // 「다시 계산하지 못했어요」와 「보냈어요」가 함께 떠 있으면 고객은 무엇을 믿을지 알 수 없다.
  it("clears the recalculation failure notice once the delivery succeeds", async () => {
    let failRecalculation = false;
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/vehicles/preparing-car/quote") {
        if (failRecalculation) {
          return Response.json(
            { success: false, error: "recalculation failed" },
            { status: 500 }
          );
        }
        return Response.json({
          success: true,
          data: createUnlockedCalculatedQuoteResult(),
        });
      }
      if (url === "/api/quote/save") {
        return Response.json({
          success: true,
          data: savedQuoteSuccessData({
            id: "saved-quote-1",
            sessionId: "saved-session-1",
          }),
        });
      }
      if (url === "/api/quote/deliver") {
        return Response.json({ success: true, data: { deliveryId: "delivery-1" } });
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      writeCalculatedRestore();
      supabaseMock.getUser.mockResolvedValue({
        data: { user: { id: "supabase-user-1" } },
      });
      vi.stubGlobal("fetch", fetchMock);

      render(<QuoteClientPageV2 vehicles={vehicles} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });

      failRecalculation = true;
      fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.getByText(/다시 계산하지 못했어요/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(screen.getByRole("button", { name: "카카오톡으로 견적서 받기" }));

    expect(await screen.findByText(/카카오톡으로 견적서를 보냈어요/)).toBeInTheDocument();
    expect(screen.queryByText(/다시 계산하지 못했어요/)).not.toBeInTheDocument();
  });

  // 보존된 비율 재적용(pendingRatesReapply) 경로는 await 도 catch 도 없이 호출된다 —
  // 네트워크 거부가 그대로 미처리 rejection 이 된다.
  it("does not leave an unhandled rejection when the reapplied-rates recalculation is rejected", async () => {
    writeGuestGatedFirstEntryRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    let quoteCalls = 0;
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async (input) => {
      const url = input.toString();
      if (url.endsWith("/colors") || url.endsWith("/trims")) {
        return Response.json({ success: true, data: [] });
      }
      if (url === "/api/vehicles/preparing-car/quote") {
        quoteCalls += 1;
        // ① 회원 자격 기준 재계산은 성공 → 보관된 비율(선납 30%) 재적용이 예약된다.
        if (quoteCalls === 1) {
          return Response.json({
            success: true,
            data: createUnlockedCalculatedQuoteResult(),
          });
        }
        // ② 그 재적용 요청에서 네트워크가 끊긴다.
        throw new TypeError("Failed to fetch");
      }
      return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const rejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandledRejection);
    try {
      render(<QuoteClientPageV2 vehicles={vehicles} />);
      // 실패는 무음 삼킴이 아니라 같은 안내로 표면화한다.
      expect(await screen.findByText(/다시 계산하지 못했어요/)).toBeInTheDocument();
      await drainPendingWork();
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});

function makePublicTrim(
  overrides: {
    readonly id?: string;
    readonly name?: string;
    readonly isDefault?: boolean;
    readonly price?: number;
    readonly availableProducts?: Array<"장기렌트" | "리스">;
  } = {},
) {
  return {
    id: overrides.id ?? "trim-default",
    name: overrides.name ?? "기본 트림",
    price: overrides.price ?? 38_000_000,
    discountPrice: null,
    evSubsidy: null,
    engineType: "GASOLINE",
    fuelEfficiency: 10,
    isDefault: overrides.isDefault ?? true,
    specs: null,
    options: [],
    rules: [],
    lineupId: null,
    lineup: null,
    availableProducts: overrides.availableProducts ?? ["장기렌트"],
  };
}

function quotePageFetchMock(options: {
  readonly colors?: Response | (() => Response);
  readonly trims?: unknown[];
  readonly quote?: unknown;
} = {}) {
  return vi.fn<
    (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  >(async (input) => {
    const url = input.toString();
    if (url.endsWith("/colors")) {
      if (typeof options.colors === "function") return options.colors();
      if (options.colors) return options.colors;
      return Response.json({ success: true, data: [] });
    }
    if (url.endsWith("/trims")) {
      return Response.json({
        success: true,
        data: options.trims ?? [makePublicTrim()],
      });
    }
    if (url.endsWith("/quote")) {
      return Response.json({
        success: true,
        data: options.quote ?? createUnlockedCalculatedQuoteResult(),
      });
    }
    return Response.json({ success: false, error: "unexpected request" }, { status: 500 });
  });
}

// T9 / R3 — 추천 트림 프리필이 목록에 없을 때 무음 유실 금지.
describe("QuoteClientPageV2 stale recommend prefill", () => {
  it("shows a fallback banner and uses the default trim when the recommended trim is gone", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&source=AI&trim=stale-trim",
    );
    const fetchMock = quotePageFetchMock({
      trims: [
        makePublicTrim({ id: "trim-default", name: "기본 트림", isDefault: true }),
        makePublicTrim({
          id: "trim-other",
          name: "다른 트림",
          isDefault: false,
          price: 42_000_000,
        }),
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(
      await screen.findByText(/추천하신 트림을 지금은 선택할 수 없어요/),
    ).toBeInTheDocument();
    const submit = await screen.findByRole("button", { name: "월 납입금 확인하기" });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([request]) => request.toString().endsWith("/quote")),
      ).toBe(true);
    });
    const quoteCall = fetchMock.mock.calls.find(([request]) =>
      request.toString().endsWith("/quote"),
    );
    expect(JSON.parse(String(quoteCall?.[1]?.body))).toMatchObject({
      trimId: "trim-default",
    });
  });
});

// T14 / Q6 — 색상 API 실패를 삼키지 않고, priceDelta 미반영 견적을 막는다.
describe("QuoteClientPageV2 color api failure", () => {
  it("renders a color fallback and blocks quote until colors load", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&trim=trim-default",
    );
    let colorsOk = false;
    const fetchMock = quotePageFetchMock({
      colors: () =>
        colorsOk
          ? Response.json({
              success: true,
              data: [
                {
                  id: "ext-white",
                  kind: "EXTERIOR",
                  name: "화이트",
                  hexCode: "#FFFFFF",
                  imageUrl: null,
                  priceDelta: 300_000,
                  isDefault: true,
                  sortOrder: 0,
                },
              ],
            })
          : Response.json({ success: false, error: "colors down" }, { status: 500 }),
      trims: [makePublicTrim({ id: "trim-default", name: "기본 트림" })],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(await screen.findByText(/색상 정보를 불러오지 못했어요/)).toBeInTheDocument();
    const submit = await screen.findByRole("button", { name: "월 납입금 확인하기" });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(
      fetchMock.mock.calls.filter(([request]) => request.toString().endsWith("/quote")),
    ).toHaveLength(0);
    expect(
      fetchMock.mock.calls.filter(([request]) => request.toString().endsWith("/colors")),
    ).toHaveLength(1);

    colorsOk = true;
    fireEvent.click(screen.getByRole("button", { name: "색상 다시 불러오기" }));
    expect(await screen.findByText("화이트")).toBeInTheDocument();
    expect(screen.queryByText(/색상 정보를 불러오지 못했어요/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "월 납입금 확인하기" })).toBeEnabled();
  });
});

// 기본 견적 무료 색상 — 테슬라처럼 유료 색상이 isDefault 로 내려오면
// 기본 견적이 추가요금과 함께 시작한다. 0원 표준색으로 시작해야 한다.
describe("QuoteClientPageV2 default color no-surcharge", () => {
  it("submits the quote with the 0-won standard color even when a surcharge color is flagged default", async () => {
    navigationMock.searchParams = new URLSearchParams(
      "vehicle=preparing-car&customerType=individual&trim=trim-default",
    );
    const teslaColors = [
      { id: "ext-black", kind: "EXTERIOR", name: "솔리드 블랙", hexCode: "#1A1A1A", imageUrl: null, priceDelta: 1_000_000, isDefault: true, sortOrder: 0 },
      { id: "ext-stealth-grey", kind: "EXTERIOR", name: "스텔스 그레이", hexCode: "#8D8E8F", imageUrl: null, priceDelta: 1_000_000, isDefault: false, sortOrder: 1 },
      { id: "ext-pearl-white", kind: "EXTERIOR", name: "펄 화이트 멀티코트", hexCode: "#F4F4F4", imageUrl: null, priceDelta: 0, isDefault: false, sortOrder: 2 },
      { id: "int-black", kind: "INTERIOR", name: "블랙 인테리어", hexCode: "#171717", imageUrl: null, priceDelta: 0, isDefault: false, sortOrder: 0 },
    ];
    const fetchMock = quotePageFetchMock({
      colors: () => Response.json({ success: true, data: teslaColors }),
      trims: [makePublicTrim({ id: "trim-default", name: "기본 트림" })],
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<QuoteClientPageV2 vehicles={vehicles} />);

    expect(await screen.findByText("펄 화이트 멀티코트")).toBeInTheDocument();
    const submit = await screen.findByRole("button", { name: "월 납입금 확인하기" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([request]) => request.toString().endsWith("/quote")),
      ).toBe(true);
    });
    const quoteCall = fetchMock.mock.calls.find(([request]) =>
      request.toString().endsWith("/quote"),
    );
    expect(JSON.parse(String(quoteCall?.[1]?.body))).toMatchObject({
      exteriorColorId: "ext-pearl-white",
      interiorColorId: "int-black",
    });
  });
});

// T13 연동 — 부모가 메인 견적 비율을 ComparisonSection primaryRates 로 넘긴다.
describe("QuoteClientPageV2 comparison primaryRates", () => {
  it("passes the main quote rates so the comparison caption matches 선납 30%", async () => {
    writeFirstEntryRestore();
    supabaseMock.getUser.mockResolvedValue({
      data: { user: { id: "supabase-user-1" } },
    });
    vi.stubGlobal("fetch", createFetchMock());

    render(<QuoteClientPageV2 vehicles={vehicles} />);
    await screen.findByRole("button", { name: "조건 다시 설정하기" });

    fireEvent.click(screen.getByRole("button", { name: /다른 차량과 비교하기/ }));
    expect(
      await screen.findByText("비교 월납입금은 선납금 30% 기준입니다"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("비교 월납입금은 보증금·선납금 없이 계산한 기준입니다"),
    ).not.toBeInTheDocument();
  });
});

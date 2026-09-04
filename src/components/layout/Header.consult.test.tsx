import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";
import type { ChannelTalkStatus } from "@/lib/channel-talk-status";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  getUser: vi.fn(),
  unsubscribe: vi.fn(),
  fetch: vi.fn(),
  openChannelTalk: vi.fn(),
  openKakaoChannelChat: vi.fn(() => true),
  state: { pathname: "/", channelStatus: null as ChannelTalkStatus | null },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.state.pathname,
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: () => null,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getUser: mocks.getUser,
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: mocks.unsubscribe } },
      }),
      signOut: vi.fn().mockResolvedValue({}),
    },
  }),
}));

vi.mock("@/lib/channel-talk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channel-talk")>()),
  openChannelTalk: mocks.openChannelTalk,
}));

vi.mock("@/lib/channel-talk-status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/channel-talk-status")>()),
  useChannelTalkStatus: () => mocks.state.channelStatus,
}));

vi.mock("@/lib/kakao/channel-add", () => ({
  openKakaoChannelChat: () => mocks.openKakaoChannelChat(),
}));

describe("Header 상담하기 · My 메뉴", () => {
  beforeEach(() => {
    mocks.state.pathname = "/";
    mocks.state.channelStatus = null;
    mocks.getUser.mockReset();
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    mocks.fetch.mockReset();
    mocks.push.mockReset();
    mocks.openChannelTalk.mockReset();
    mocks.openKakaoChannelChat.mockReset();
    mocks.openKakaoChannelChat.mockReturnValue(true);
    vi.stubGlobal("fetch", mocks.fetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function openConsultPanel() {
    const trigger = screen.getByRole("button", { name: "상담하기" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    return trigger;
  }

  it("상담하기를 누르면 채널톡·전화 상담 옵션을 보여준다", () => {
    render(<Header />);

    openConsultPanel();

    expect(
      screen.getByRole("menuitem", { name: /채널톡 상담하기/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("로그인 없이도 가능해요!")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /전화 상담하기/ }),
    ).toHaveAttribute("href", "tel:16888479");
  });

  it("모바일에서는 상담하기를 누르면 로그인 없이 카카오 채널 안내를 보여준다", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    );
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "상담하기" }));

    expect(
      screen.getByRole("dialog", { name: "카카오톡에서 상담을 시작할게요" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /채널톡 상담하기/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "카카오톡 상담 시작하기" }));
    expect(mocks.openKakaoChannelChat).toHaveBeenCalledTimes(1);
    expect(mocks.openChannelTalk).not.toHaveBeenCalled();
  });

  it("채널톡 옵션을 누르면 메신저를 열고 패널을 닫는다", () => {
    render(<Header />);

    openConsultPanel();
    fireEvent.click(screen.getByRole("menuitem", { name: /채널톡 상담하기/ }));

    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("menuitem", { name: /전화 상담하기/ }),
    ).not.toBeInTheDocument();
  });

  it("채널톡 로딩 중에는 상담 옵션이 비활성화된다", () => {
    mocks.state.channelStatus = "loading";
    render(<Header />);

    openConsultPanel();

    const option = screen.getByRole("menuitem", { name: /채팅 준비 중/ });
    expect(option).toBeDisabled();
  });

  it("채널톡 억제 경로에서는 전화 상담 옵션만 보여준다", () => {
    mocks.state.pathname = "/verify";
    render(<Header />);

    openConsultPanel();

    expect(
      screen.queryByRole("menuitem", { name: /채널톡 상담하기|채팅 준비 중/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: /전화 상담하기/ }),
    ).toBeInTheDocument();
  });

  it("ESC 키를 누르면 상담 패널이 닫히고 포커스가 트리거로 돌아온다", () => {
    render(<Header />);

    const trigger = openConsultPanel();
    fireEvent.keyDown(document, { key: "Escape" });

    expect(
      screen.queryByRole("menuitem", { name: /전화 상담하기/ }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("닫기 버튼을 누르면 상담 패널이 닫히고 포커스가 트리거로 돌아온다", () => {
    render(<Header />);

    const trigger = openConsultPanel();
    fireEvent.click(screen.getByRole("button", { name: "상담 메뉴 닫기" }));

    expect(
      screen.queryByRole("menuitem", { name: /전화 상담하기/ }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("비로그인 My 버튼은 로그인으로 보낸다", () => {
    render(<Header />);

    fireEvent.click(screen.getByRole("button", { name: "로그인" }));
    expect(mocks.push).toHaveBeenCalledWith(expect.stringContaining("/login?next="));
  });

  it("로그인 회원 My 메뉴에 아이콘 메뉴 항목이 있다", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "u1",
          email: "test@example.com",
          user_metadata: { name: "테스트 고객" },
        },
      },
    });
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { role: "member" } }),
    });
    render(<Header />);

    const myButton = await screen.findByRole("button", { name: "My 메뉴 열기" });
    fireEvent.click(myButton);

    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "내 견적보기" })).toHaveAttribute(
        "href",
        "/mypage/quotes",
      );
    });
    expect(screen.getByRole("menuitem", { name: "추천인 페이지" })).toHaveAttribute(
      "href",
      "/mypage/referral",
    );
    expect(screen.getByRole("menuitem", { name: "쿠폰함" })).toHaveAttribute(
      "href",
      "/mypage/coupons",
    );
    expect(screen.getByRole("menuitem", { name: "내 정보" })).toHaveAttribute(
      "href",
      "/mypage/profile",
    );
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeInTheDocument();
  });
});

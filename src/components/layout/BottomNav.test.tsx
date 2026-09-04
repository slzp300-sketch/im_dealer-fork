import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";
import {
  DOCK_BOTTOM_PADDING_CLASS,
  STACK_OFFSET_COLLAPSED,
  STACK_OFFSET_EXPANDED,
} from "./dock";

const mocks = vi.hoisted(() => ({
  pathname: "/",
  openChannelTalk: vi.fn(),
  openKakaoChannelChat: vi.fn(() => true),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/lib/channel-talk", () => ({
  openChannelTalk: () => mocks.openChannelTalk(),
}));

vi.mock("@/lib/kakao/channel-add", () => ({
  openKakaoChannelChat: () => mocks.openKakaoChannelChat(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = ({
    children,
    ...props
  }: React.PropsWithChildren<Record<string, unknown>>) => {
    const {
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      whileTap: _w,
      layout: _l,
      ...rest
    } = props;
    return React.createElement("div", rest, children);
  };

  return {
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
    motion: {
      div: passthrough,
      span: passthrough,
      button: ({
        children,
        ...props
      }: React.PropsWithChildren<Record<string, unknown>>) => {
        const {
          initial: _i,
          animate: _a,
          exit: _e,
          transition: _t,
          whileTap: _w,
          ...rest
        } = props;
        return React.createElement("button", rest, children);
      },
    },
    useReducedMotion: () => true,
  };
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => y,
  });
  Object.defineProperty(window, "pageYOffset", {
    configurable: true,
    get: () => y,
  });
}

describe("BottomNav scroll collapse", () => {
  beforeEach(() => {
    mocks.pathname = "/cars/genesis-11644";
    mocks.openChannelTalk.mockReset();
    mocks.openKakaoChannelChat.mockReset();
    mocks.openKakaoChannelChat.mockReturnValue(true);
    setScrollY(0);
    document.documentElement.style.removeProperty("--bottom-nav-stack-offset");
    vi.stubGlobal(
      "requestAnimationFrame",
      (cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      },
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    document.documentElement.style.removeProperty("--bottom-nav-stack-offset");
    vi.unstubAllGlobals();
  });

  it("초기에는 펼쳐진 메뉴를 보여준다", () => {
    render(<BottomNav />);
    const nav = screen.getByRole("navigation", { name: "하단 메뉴" });
    expect(nav).toHaveAttribute("data-collapsed", "false");
    expect(nav.firstElementChild?.className.split(/\s+/)).toContain(DOCK_BOTTOM_PADDING_CLASS);
    expect(screen.getByLabelText("홈")).toBeInTheDocument();
    expect(screen.getByLabelText("차량 탐색")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--bottom-nav-stack-offset")).toBe(
      STACK_OFFSET_EXPANDED,
    );
  });

  it("하단 상담을 누르면 안내 후 로그인 없이 카카오 채널로 연결한다", () => {
    render(<BottomNav />);

    fireEvent.click(screen.getByRole("button", { name: "상담" }));
    expect(
      screen.getByRole("dialog", { name: "카카오톡에서 상담을 시작할게요" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/회원가입이나 로그인 없이/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "카카오톡 상담 시작하기" }));
    expect(mocks.openKakaoChannelChat).toHaveBeenCalledTimes(1);
    expect(mocks.openChannelTalk).not.toHaveBeenCalled();
  });

  it("스크롤을 내리면 점(FAB)으로 축소된다", () => {
    render(<BottomNav />);

    act(() => {
      setScrollY(200);
      fireEvent.scroll(window);
    });

    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("홈")).not.toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--bottom-nav-stack-offset")).toBe(
      STACK_OFFSET_COLLAPSED,
    );
  });

  it("중간에서 스크롤을 올려도 메뉴는 접힌 채 유지된다", () => {
    render(<BottomNav />);

    act(() => {
      setScrollY(240);
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeInTheDocument();

    act(() => {
      setScrollY(180);
      fireEvent.scroll(window);
    });

    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeInTheDocument();
    expect(screen.queryByLabelText("홈")).not.toBeInTheDocument();
  });

  it("중간에서 조금 올려도 펼쳐지지 않고, 최상단(≤12px)에서만 펼쳐진다", () => {
    render(<BottomNav />);

    act(() => {
      setScrollY(300);
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeInTheDocument();

    // 중간 구간으로 올림 → 여전히 접힘
    act(() => {
      setScrollY(120);
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    act(() => {
      setScrollY(40);
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    // 거의 끝(최상단)까지 올림 → 펼침
    act(() => {
      setScrollY(8);
      fireEvent.scroll(window);
    });

    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "false",
    );
    expect(screen.getByLabelText("홈")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue("--bottom-nav-stack-offset")).toBe(
      STACK_OFFSET_EXPANDED,
    );
  });

  it("점을 누르면 메뉴가 다시 펼쳐진다", () => {
    render(<BottomNav />);

    act(() => {
      setScrollY(300);
      fireEvent.scroll(window);
    });

    fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));

    expect(screen.getByRole("navigation", { name: "하단 메뉴" })).toHaveAttribute(
      "data-collapsed",
      "false",
    );
    expect(screen.getByLabelText("차량 탐색")).toBeInTheDocument();
  });


  it("축소 상태에서는 네비 바깥 영역 클릭을 가로채지 않는다", () => {
    render(<BottomNav />);

    act(() => {
      setScrollY(220);
      fireEvent.scroll(window);
    });

    const nav = screen.getByRole("navigation", { name: "하단 메뉴" });
    const fab = screen.getByRole("button", { name: "메뉴 열기" });
    expect(nav.className).toContain("pointer-events-none");
    expect(fab.className).toContain("pointer-events-auto");
  });

  it("견적 경로에서는 렌더하지 않는다", () => {
    mocks.pathname = "/quote?vehicle=test";
    const { container } = render(<BottomNav />);
    expect(container).toBeEmptyDOMElement();
  });
});

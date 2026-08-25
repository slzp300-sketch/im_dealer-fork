import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobileQuoteSummary } from "./CarDetailQuoteSurfaces";

const mocks = vi.hoisted(() => ({
  openChannelTalk: vi.fn(() => true),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/channel-talk", () => ({
  openChannelTalk: () => mocks.openChannelTalk(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const passthrough = ({
    children,
    className,
    style,
    ...props
  }: React.PropsWithChildren<Record<string, unknown> & { className?: string; style?: React.CSSProperties }>) => {
    const {
      initial: _i,
      animate: _a,
      exit: _e,
      transition: _t,
      whileTap: _w,
      layout: _l,
      ...rest
    } = props;
    return React.createElement("div", { className, style, ...rest }, children);
  };

  return {
    AnimatePresence: ({ children }: React.PropsWithChildren) => <>{children}</>,
    motion: {
      div: passthrough,
      span: passthrough,
      button: passthrough,
    },
    useReducedMotion: () => true,
  };
});

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", {
    configurable: true,
    get: () => y,
  });
  Object.defineProperty(document.documentElement, "scrollTop", {
    configurable: true,
    get: () => y,
  });
  Object.defineProperty(document.body, "scrollTop", {
    configurable: true,
    get: () => y,
  });
}

describe("MobileQuoteSummary sticky dock", () => {
  beforeEach(() => {
    mocks.openChannelTalk.mockClear();
    setScrollY(0);
    document.documentElement.dataset.bottomNavCollapsed = "true";
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("스크롤 후 sticky 상담/견적 버튼이 동작한다", () => {
    render(
      <MobileQuoteSummary
        vehicleName="쏘렌토"
        vehicleSlug="sorento"
        quotes={[
          {
            productType: "장기렌트",
            monthlyPayment: 450000,
            financeCompanyName: "ORIX",
          },
        ]}
      />,
    );

    act(() => {
      setScrollY(220);
      fireEvent.scroll(window);
    });

    const dock = document.querySelector(".mobile-sticky-quote-dock");
    expect(dock).not.toBeNull();
    expect(dock?.className).toContain("pointer-events-none");

    const consultButtons = screen.getAllByRole("button", { name: "상담" });
    expect(consultButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(consultButtons[consultButtons.length - 1]);
    expect(mocks.openChannelTalk).toHaveBeenCalledTimes(1);

    const quoteLinks = screen.getAllByRole("link", { name: /AI 셀프 견적내기/ });
    const stickyQuote = quoteLinks[quoteLinks.length - 1];
    expect(stickyQuote).toHaveAttribute("href", "/quote?vehicle=sorento");
    expect(stickyQuote.parentElement?.className).toContain("pointer-events-auto");
  });
});

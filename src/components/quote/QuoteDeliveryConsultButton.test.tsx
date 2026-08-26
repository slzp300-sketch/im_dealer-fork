import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildQuoteConsultMessage,
  QuoteDeliveryConsultButton,
} from "./QuoteDeliveryConsultButton";

const CHAT_URL = "https://pf.kakao.com/_imdealer/chat";

function renderButton() {
  render(<QuoteDeliveryConsultButton vehicleName="쏘렌토" deliveryId="dlv_1" />);
  return screen.getByRole("button", { name: /담당자에게 문의하기/ });
}

function setAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: userAgent,
    configurable: true,
  });
}

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128";

let writeText: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = "_imdealer";
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  open = vi.fn().mockReturnValue({} as Window);
  window.open = open as unknown as typeof window.open;
});

afterEach(() => {
  delete window.ChannelIO;
  vi.restoreAllMocks();
});

describe("QuoteDeliveryConsultButton", () => {
  // 승인된 템플릿에 상담톡 전환 버튼이 없어, 착지 화면이 유일한 상담 진입점이다.
  it("모바일에서는 카카오 채널 대화창을 연다", () => {
    setAgent(IPHONE);

    fireEvent.click(renderButton());

    expect(open).toHaveBeenCalledWith(CHAT_URL, "_blank", "noopener,noreferrer");
  });

  it("PC 에서는 채널톡 메신저를 연다", () => {
    setAgent(DESKTOP);
    const calls: unknown[][] = [];
    window.ChannelIO = (...args: unknown[]) => {
      calls.push(args);
    };

    fireEvent.click(renderButton());

    expect(calls).toEqual([["showMessenger"]]);
    expect(open).not.toHaveBeenCalled();
  });

  // 카카오는 대화 프리필을 지원하지 않아 붙여넣기가 유일한 수단이다.
  it("문의 문구를 복사하고 화면에도 남긴다", () => {
    setAgent(IPHONE);

    fireEvent.click(renderButton());

    expect(writeText).toHaveBeenCalledWith(buildQuoteConsultMessage("쏘렌토", "dlv_1"));
    // 복사가 막히는 인앱 브라우저가 있어 문구 자체도 화면에 남는다.
    expect(screen.getByText(/견적번호: dlv_1/)).toBeInTheDocument();
    expect(screen.getByText(/붙여넣어 보내주세요/)).toBeInTheDocument();
  });

  // 인앱 브라우저에서 팝업이 막히면 그대로 이탈해 버린다.
  it("팝업이 막히면 같은 탭에서 대화창으로 이동한다", () => {
    setAgent(IPHONE);
    open.mockReturnValue(null);
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      value: { set href(url: string) { assign(url); } },
      configurable: true,
    });

    fireEvent.click(renderButton());

    expect(assign).toHaveBeenCalledWith(CHAT_URL);
  });

  it("견적번호가 문구에 들어간다", () => {
    expect(buildQuoteConsultMessage("쏘렌토", "dlv_1")).toContain("견적번호: dlv_1");
  });
});

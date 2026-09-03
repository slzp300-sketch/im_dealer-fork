import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isMobileDevice: vi.fn(),
  kakaoChannelChatUrl: vi.fn(),
}));

vi.mock("@/lib/browser/device", () => ({ isMobileDevice: mocks.isMobileDevice }));
vi.mock("@/lib/kakao/channel-add", () => ({
  kakaoChannelChatUrl: mocks.kakaoChannelChatUrl,
}));

import { openChannelTalk, openChannelTalkWithQuote } from "./channel-talk";

const KAKAO_URL = "https://pf.kakao.com/_test/chat";
const quoteContext = {
  quoteId: "q1",
  sessionId: "s1",
  vehicleName: "아이오닉6",
  trimName: "롱레인지",
  productType: "장기렌트" as const,
  contractMonths: 36,
  annualMileage: 20000,
};

describe("openChannelTalk — 접속 환경별 분리(모바일 카카오 / PC 위젯)", () => {
  let channelIO: ReturnType<typeof vi.fn>;
  let openSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    channelIO = vi.fn();
    (window as unknown as { ChannelIO?: unknown }).ChannelIO = channelIO;
    openSpy = vi.spyOn(window, "open").mockReturnValue({} as Window) as never;
    mocks.kakaoChannelChatUrl.mockReturnValue(KAKAO_URL);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { ChannelIO?: unknown }).ChannelIO;
    vi.clearAllMocks();
  });

  it("모바일이면 카카오 대화방을 열고 채널톡 위젯은 열지 않는다", () => {
    mocks.isMobileDevice.mockReturnValue(true);

    expect(openChannelTalk()).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(KAKAO_URL, "_blank", "noopener,noreferrer");
    expect(channelIO).not.toHaveBeenCalled();
  });

  it("PC 면 채널톡 위젯을 연다(카카오로 보내지 않는다)", () => {
    mocks.isMobileDevice.mockReturnValue(false);

    expect(openChannelTalk()).toBe(true);
    expect(channelIO).toHaveBeenCalledWith("showMessenger");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("모바일이라도 카카오 URL 이 없으면 위젯으로 폴백한다", () => {
    mocks.isMobileDevice.mockReturnValue(true);
    mocks.kakaoChannelChatUrl.mockReturnValue(null);

    expect(openChannelTalk()).toBe(true);
    expect(channelIO).toHaveBeenCalledWith("showMessenger");
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("openChannelTalkWithQuote: 모바일은 카카오로 보내고 track 은 생략한다", () => {
    mocks.isMobileDevice.mockReturnValue(true);

    expect(openChannelTalkWithQuote(quoteContext)).toBe(true);
    expect(openSpy).toHaveBeenCalledWith(KAKAO_URL, "_blank", "noopener,noreferrer");
    expect(channelIO).not.toHaveBeenCalled();
  });

  it("openChannelTalkWithQuote: PC 는 견적 컨텍스트 track 후 위젯을 연다", () => {
    mocks.isMobileDevice.mockReturnValue(false);

    expect(openChannelTalkWithQuote(quoteContext)).toBe(true);
    expect(channelIO).toHaveBeenCalledWith(
      "track",
      "quote_consultation_requested",
      quoteContext
    );
    expect(channelIO).toHaveBeenCalledWith("showMessenger");
  });
});

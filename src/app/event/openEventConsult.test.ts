import { afterEach, describe, expect, it, vi } from "vitest";
import { openEventConsult } from "./openEventConsult";
import { openChannelTalk, trackEventConsultation } from "@/lib/channel-talk";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";

vi.mock("@/lib/channel-talk", () => ({
  openChannelTalk: vi.fn(),
  trackEventConsultation: vi.fn(),
}));
vi.mock("@/lib/kakao/channel-add", () => ({
  kakaoChannelChatUrl: vi.fn(),
}));

const context = {
  source: "/event" as const,
  vehicleName: "르노코리아 필랑트",
  trimName: "하이브리드 E-tech iconic",
  monthlyPrice: "월 66만원",
  discount: "420만원",
};

describe("openEventConsult", () => {
  afterEach(() => vi.clearAllMocks());

  it("tracks first and opens the configured Kakao URL exactly once", () => {
    vi.mocked(kakaoChannelChatUrl).mockReturnValue("https://pf.kakao.com/_test/chat");
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    openEventConsult(context);

    expect(trackEventConsultation).toHaveBeenCalledOnce();
    expect(trackEventConsultation).toHaveBeenCalledWith(context);
    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      "https://pf.kakao.com/_test/chat",
      "_blank",
      "noopener,noreferrer"
    );
    expect(openChannelTalk).not.toHaveBeenCalled();
    expect((trackEventConsultation as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      open.mock.invocationCallOrder[0]
    );
  });

  it("tracks first and falls back to ChannelTalk when Kakao URL is null", () => {
    vi.mocked(kakaoChannelChatUrl).mockReturnValue(null);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    openEventConsult({ source: "/event" });

    expect(trackEventConsultation).toHaveBeenCalledOnce();
    expect(trackEventConsultation).toHaveBeenCalledWith({ source: "/event" });
    expect(openChannelTalk).toHaveBeenCalledOnce();
    expect(open).not.toHaveBeenCalled();
  });
});

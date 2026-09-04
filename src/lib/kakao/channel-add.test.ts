import { afterEach, describe, expect, it, vi } from "vitest";
import { kakaoChannelChatUrl, openKakaoChannelChat } from "./channel-add";

const ORIGINAL_CHANNEL_ID = process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID;

afterEach(() => {
  if (ORIGINAL_CHANNEL_ID === undefined) {
    delete process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID;
  } else {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = ORIGINAL_CHANNEL_ID;
  }
  vi.restoreAllMocks();
});

describe("Kakao channel chat", () => {
  it("채널 공개 ID로 1:1 채팅 URL을 만든다", () => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = "_imdealer";
    expect(kakaoChannelChatUrl()).toBe("https://pf.kakao.com/_imdealer/chat");
  });

  it("사용자 클릭에서 카카오 채널 채팅을 새 창으로 연다", () => {
    process.env.NEXT_PUBLIC_KAKAO_CHANNEL_PUBLIC_ID = "_imdealer";
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);

    expect(openKakaoChannelChat()).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://pf.kakao.com/_imdealer/chat",
      "_blank",
      "noopener,noreferrer",
    );
  });
});

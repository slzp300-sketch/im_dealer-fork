import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CHANNEL_TALK_STATUS_ATTR } from "@/lib/channel-talk-status";
import { ChannelTalkButton } from "./ChannelTalkButton";

// useConsultEntry → useAuthUser 가 Supabase 클라이언트를 만들지 않도록 훅을 대체한다.
// 플래그 기본 꺼짐 + 비회원이라 기존 동작(openChannelTalk)이 그대로 유지된다.
vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({ user: null, isLoading: false }),
}));

afterEach(() => {
  delete window.ChannelIO;
  document.documentElement.removeAttribute(CHANNEL_TALK_STATUS_ATTR);
});

describe("ChannelTalkButton", () => {
  it("opens ChannelTalk with the same action as the global consultation buttons", () => {
    const calls: unknown[][] = [];
    window.ChannelIO = (...args: unknown[]) => {
      calls.push(args);
    };

    render(<ChannelTalkButton vehicleName="신형 G90" label="상담하기" />);

    fireEvent.click(screen.getByRole("button", { name: /상담하기/ }));

    expect(calls).toEqual([["showMessenger"]]);
  });
});

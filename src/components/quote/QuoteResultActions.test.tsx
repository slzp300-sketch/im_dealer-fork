import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DOCK_BOTTOM_PADDING_CLASS } from "@/components/layout/dock";
import { CHANNEL_TALK_STATUS_ATTR } from "@/lib/channel-talk-status";
import { QuoteResultActions } from "./QuoteResultActions";

const props = {
  kakaoDeliveryEnabled: true,
  channelTalkDelivery: false,
  isDelivering: false,
  deliverySuccess: false,
  deliveryError: null,
  onQuoteDeliver: () => undefined,
  onReopenChannelChat: () => undefined,
  onConfirmChannelSent: () => undefined,
  deliveryConfirmedBySender: false,
};

describe("QuoteResultActions", () => {
  afterEach(() => {
    delete window.ChannelIO;
    document.documentElement.removeAttribute(CHANNEL_TALK_STATUS_ATTR);
    vi.restoreAllMocks();
  });

  describe("Given a completed quote result", () => {
    it("When rendered Then it exposes delivery and review-request actions", () => {
      render(<QuoteResultActions {...props} />);

      expect(
        screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "심사 요청하기" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "상담하기" })).toBeInTheDocument();
      expect(screen.queryByText("서류 심사 서비스는 준비 중이에요")).not.toBeInTheDocument();
    });

    it("When review request is selected Then it opens the coming-soon modal with contact CTAs", () => {
      render(<QuoteResultActions {...props} />);

      fireEvent.click(screen.getByRole("button", { name: "심사 요청하기" }));

      expect(
        screen.getByRole("dialog", { name: "서류 심사 서비스는 준비 중이에요" })
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /1688-8479 전화 걸기/ })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: "상담하기" }).length).toBeGreaterThanOrEqual(1);
    });

    it("When Kakao delivery is selected Then it calls the supplied callback", () => {
      const onQuoteDeliver = vi.fn<() => void>();
      render(
        <QuoteResultActions
          {...props}
          onQuoteDeliver={onQuoteDeliver}
        />
      );

      fireEvent.click(
        screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
      );

      expect(onQuoteDeliver).toHaveBeenCalledTimes(1);
    });

    it("When both delivery modes are disabled Then it hides only the delivery action", () => {
      render(
        <QuoteResultActions
          {...props}
          kakaoDeliveryEnabled={false}
          channelTalkDelivery={false}
        />
      );

      expect(
        screen.queryByRole("button", { name: "카카오톡으로 견적서 받기" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "견적서 받기" })
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "심사 요청하기" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "상담하기" })).toBeInTheDocument();
    });

    it("When delivery is available Then it pins a transparent floating action above the home indicator", () => {
      render(<QuoteResultActions {...props} />);

      const bar = screen.getByRole("region", { name: "견적서 받기" });
      expect(bar.className).toMatch(/\bfixed\b/);
      expect(bar.className).toMatch(/\bbottom-0\b/);
      expect(bar.className).toMatch(/\bpx-5\b/);
      expect(bar.className.split(/\s+/)).toContain(DOCK_BOTTOM_PADDING_CLASS);
      expect(bar.className).not.toMatch(/\bborder-t\b/);
      expect(bar.className).not.toMatch(/bg-surface/);
      expect(bar.className).not.toMatch(/backdrop-blur/);
      expect(
        screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
      ).toBe(bar.querySelector("button"));
    });

    it("When idle Then it shows the no-sales-call balloon above the delivery button", () => {
      render(<QuoteResultActions {...props} />);

      const balloon = screen.getByText("영업전화 가지 않아요~!");
      expect(balloon.className).toMatch(/animate-headshake/);
      expect(balloon.className).toMatch(/pointer-events-none/);
    });

    it("When delivering, succeeded, or failed Then it hides the no-sales-call balloon", () => {
      const { rerender } = render(<QuoteResultActions {...props} isDelivering />);
      expect(screen.queryByText("영업전화 가지 않아요~!")).not.toBeInTheDocument();

      rerender(<QuoteResultActions {...props} deliverySuccess />);
      expect(screen.queryByText("영업전화 가지 않아요~!")).not.toBeInTheDocument();

      rerender(<QuoteResultActions {...props} deliveryError="카카오톡 전송에 실패했습니다." />);
      expect(screen.queryByText("영업전화 가지 않아요~!")).not.toBeInTheDocument();
    });

    it("When Kakao delivery is pending Then it exposes the busy state", () => {
      render(<QuoteResultActions {...props} isDelivering />);

      const deliveryButton = screen.getByRole("button", { name: "전송 중…" });
      expect(deliveryButton).toBeDisabled();
      expect(deliveryButton).toHaveAttribute("aria-busy", "true");
    });

    it("When Kakao delivery succeeds Then it renders the completion status in the fixed bar", () => {
      render(<QuoteResultActions {...props} deliverySuccess />);

      const bar = screen.getByRole("region", { name: "견적서 받기" });
      expect(bar).toHaveTextContent("카카오톡으로 견적서를 보냈어요.");
      expect(bar.className).not.toMatch(/\bborder-t\b/);
      expect(bar.className).not.toMatch(/bg-surface/);
      expect(bar.className).not.toMatch(/backdrop-blur/);
      expect(screen.getByRole("status").className).toMatch(/bg-brand-soft/);
    });

    it("When includeDeliveryBar is false Then it keeps secondary actions only", () => {
      render(<QuoteResultActions {...props} includeDeliveryBar={false} />);

      expect(
        screen.queryByRole("region", { name: "견적서 받기" })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "카카오톡으로 견적서 받기" })
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "심사 요청하기" })).toBeInTheDocument();
    });

    it("When Kakao delivery fails Then it renders the supplied error", () => {
      render(
        <QuoteResultActions
          {...props}
          deliveryError="카카오톡 전송에 실패했습니다."
        />
      );

      const bar = screen.getByRole("region", { name: "견적서 받기" });
      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("카카오톡 전송에 실패했습니다.");
      expect(bar).toContainElement(alert);
      expect(bar.className).not.toMatch(/bg-surface/);
      expect(alert.className).toMatch(/bg-status-danger-soft/);
    });
  });

  describe("Given the ChannelTalk delivery stopgap (Kakao auto-send off)", () => {
    const stopgapProps = {
      ...props,
      kakaoDeliveryEnabled: false,
      channelTalkDelivery: true,
    };

    it("When rendered Then it still exposes the quote delivery action", () => {
      render(<QuoteResultActions {...stopgapProps} />);

      expect(
        screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
      ).toBeInTheDocument();
    });

    it("When the delivery action is selected Then it calls the supplied callback", () => {
      const onQuoteDeliver = vi.fn<() => void>();
      render(
        <QuoteResultActions {...stopgapProps} onQuoteDeliver={onQuoteDeliver} />
      );

      fireEvent.click(
        screen.getByRole("button", { name: "카카오톡으로 견적서 받기" })
      );

      expect(onQuoteDeliver).toHaveBeenCalledTimes(1);
    });

    it("When pending Then it shows the ChannelTalk busy label", () => {
      render(<QuoteResultActions {...stopgapProps} isDelivering />);

      const deliveryButton = screen.getByRole("button", { name: "요청 준비 중…" });
      expect(deliveryButton).toBeDisabled();
      expect(deliveryButton).toHaveAttribute("aria-busy", "true");
    });

    it("When the chat opens Then it states the request is not sent yet", () => {
      render(<QuoteResultActions {...stopgapProps} deliverySuccess />);

      const bar = screen.getByRole("region", { name: "견적서 받기" });
      const status = screen.getByRole("status");
      expect(bar).toContainElement(status);
      expect(status).toHaveTextContent("아직 보내지 않았어요");
      expect(status).not.toHaveTextContent("요청 메시지를 복사했어요");
      expect(bar.className).not.toMatch(/\bborder-t\b/);
      expect(bar.className).not.toMatch(/bg-surface/);
      expect(status.parentElement?.className).toMatch(/bg-status-warning-soft/);
    });

    it("When the customer confirms they sent it Then it calls the supplied callback", () => {
      const onConfirmChannelSent = vi.fn<() => void>();
      render(
        <QuoteResultActions
          {...stopgapProps}
          deliverySuccess
          onConfirmChannelSent={onConfirmChannelSent}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "보냈어요" }));

      expect(onConfirmChannelSent).toHaveBeenCalledTimes(1);
    });

    it("When the customer confirmed sending Then it drops the warning and thanks them", () => {
      render(
        <QuoteResultActions {...stopgapProps} deliverySuccess deliveryConfirmedBySender />
      );

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("상담사가 확인 후");
      expect(status).not.toHaveTextContent("아직 보내지 않았어요");
      expect(screen.queryByRole("button", { name: "보냈어요" })).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "대화창 다시 열기" })
      ).toBeInTheDocument();
    });

    // 상담전환톡 흐름 — 이미 카카오톡으로 안내가 나갔다. 붙여넣기 경고·보냈어요
    // 자가 확인을 그리면 고객이 무엇을 해야 하는지 알 수 없게 된다.
    it("When the alimtalk went out Then it points at the Kakao message instead of paste", () => {
      render(
        <QuoteResultActions {...stopgapProps} deliverySuccess alimtalkDelivery />
      );

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("카카오톡으로 안내 메시지를 보냈어요");
      expect(status).not.toHaveTextContent("아직 보내지 않았어요");
      expect(status).not.toHaveTextContent("붙여넣기");
      expect(screen.queryByRole("button", { name: "보냈어요" })).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "대화창 다시 열기" })
      ).not.toBeInTheDocument();
    });

    it("When the chat window was closed Then it offers to reopen it", () => {
      const onReopenChannelChat = vi.fn<() => void>();
      render(
        <QuoteResultActions
          {...stopgapProps}
          deliverySuccess
          onReopenChannelChat={onReopenChannelChat}
        />
      );

      fireEvent.click(screen.getByRole("button", { name: "대화창 다시 열기" }));

      expect(onReopenChannelChat).toHaveBeenCalledTimes(1);
    });

    it("When the chat has not been opened yet Then it hides the reopen action", () => {
      render(<QuoteResultActions {...stopgapProps} />);

      expect(
        screen.queryByRole("button", { name: "대화창 다시 열기" })
      ).not.toBeInTheDocument();
    });
  });

  describe("Given ChannelTalk is available", () => {
    it("When consultation is selected Then it shows the generic messenger", () => {
      const calls: unknown[][] = [];
      window.ChannelIO = (...args: unknown[]) => {
        calls.push(args);
      };
      render(<QuoteResultActions {...props} />);

      fireEvent.click(screen.getByRole("button", { name: "상담하기" }));

      expect(calls).toEqual([["showMessenger"]]);
    });
  });
});

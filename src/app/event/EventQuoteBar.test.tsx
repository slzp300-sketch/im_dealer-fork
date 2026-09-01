import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventQuoteBar } from "./EventQuoteBar";

const { openEventConsultMock } = vi.hoisted(() => ({
  openEventConsultMock: vi.fn(),
}));

vi.mock("./openEventConsult", () => ({
  openEventConsult: openEventConsultMock,
}));

describe("EventQuoteBar", () => {
  beforeEach(() => {
    openEventConsultMock.mockClear();
  });

  it("exposes only the real-time consultation action", () => {
    const { container } = render(<EventQuoteBar />);

    const region = screen.getByRole("region", { name: "실시간 문의하기" });
    const button = screen.getByRole("button", { name: "실시간 문의하기" });

    expect(button).toHaveTextContent(/^실시간 문의하기$/);
    expect(region).toContainElement(button);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(container.querySelector('a[href="/cars"]')).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "AI 셀프 견적내기" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "AI" })).not.toBeInTheDocument();
  });

  it("opens one source-only event consultation on click", () => {
    render(<EventQuoteBar />);

    fireEvent.click(
      screen.getByRole("button", { name: "실시간 문의하기" }),
    );

    expect(openEventConsultMock).toHaveBeenCalledTimes(1);
    expect(openEventConsultMock).toHaveBeenCalledWith({ source: "/event" });
  });
});

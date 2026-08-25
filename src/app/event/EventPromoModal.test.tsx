import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventPromoModal } from "./EventPromoModal";
import type { EventCar } from "./VehicleCard";

vi.mock("@/lib/channel-talk", () => ({
  openChannelTalk: vi.fn(),
  trackEventConsultation: vi.fn(),
}));
vi.mock("@/lib/kakao/channel-add", () => ({
  kakaoChannelChatUrl: vi.fn(() => "https://pf.kakao.com/_test/chat"),
}));

import { trackEventConsultation } from "@/lib/channel-talk";

const car: EventCar = {
  id: "filant",
  brand: "르노코리아",
  model: "필랑트",
  trim: "하이브리드 E-tech iconic",
  option: "",
  stock: "3대",
  image: "/images/event/filant.webp",
  wasMonthly: "73",
  nowMonthly: "66",
  discount: "420만원",
  listPrice: "50,850,000원",
};

describe("EventPromoModal", () => {
  beforeEach(() => {
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("When open Then it shows the promo pitch, checklist, and reassurance band", () => {
    render(<EventPromoModal open onClose={() => undefined} />);

    expect(
      screen.getByRole("dialog", { name: "지금이 가장 싼 순간!" })
    ).toBeInTheDocument();
    expect(screen.getByText("초기비용 0원 견적")).toBeInTheDocument();
    expect(
      screen.getByText("보증금·선납금 조건 변경하면 더 싸져요")
    ).toBeInTheDocument();
    expect(screen.getByText("영업전화 절대 안 해요")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "카카오톡으로 상담하기" })
    ).toBeInTheDocument();
  });

  it("When closed Then it renders nothing", () => {
    render(<EventPromoModal open={false} onClose={() => undefined} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("When confirmed without a car Then it tracks the source and opens the Kakao chat", () => {
    const onClose = vi.fn();
    render(<EventPromoModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "카카오톡으로 상담하기" }));

    expect(trackEventConsultation).toHaveBeenCalledWith({ source: "/event" });
    expect(window.open).toHaveBeenCalledWith(
      "https://pf.kakao.com/_test/chat",
      "_blank",
      "noopener,noreferrer"
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("When opened from a vehicle card Then it shows the car context and tracks its details", () => {
    render(<EventPromoModal open onClose={() => undefined} car={car} />);

    expect(screen.getByText("르노코리아 필랑트")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "카카오톡으로 상담하기" }));

    expect(trackEventConsultation).toHaveBeenCalledWith({
      source: "/event",
      vehicleName: "르노코리아 필랑트",
      trimName: "하이브리드 E-tech iconic",
      monthlyPrice: "월 66만원",
      discount: "420만원",
    });
  });

  it("When the close control or Escape is used Then it calls onClose", () => {
    const onClose = vi.fn();
    render(<EventPromoModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

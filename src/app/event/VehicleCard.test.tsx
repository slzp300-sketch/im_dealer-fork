import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openEventConsult } from "./openEventConsult";
import { EventConsultCard, VehicleCard, type EventCar } from "./VehicleCard";

type MockMotionProps = {
  readonly initial?: unknown;
  readonly transition?: unknown;
  readonly viewport?: unknown;
  readonly whileInView?: unknown;
};

type MockMotionButtonProps = ComponentProps<"button"> & MockMotionProps;
type MockMotionDivProps = ComponentProps<"div"> & MockMotionProps;

vi.mock("framer-motion", () => ({
  motion: {
    button: ({ initial, transition, viewport, whileInView, ...props }: MockMotionButtonProps) => (
      <button {...props} />
    ),
    div: ({ initial, transition, viewport, whileInView, ...props }: MockMotionDivProps) => (
      <div {...props} />
    ),
  },
}));

vi.mock("./openEventConsult", () => ({
  openEventConsult: vi.fn(),
}));

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

describe("VehicleCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens consultation directly with the exact vehicle context and no dialog", () => {
    render(<VehicleCard car={car} />);

    const vehicleCard = screen.getByRole("button", {
      name: "르노코리아 필랑트 하이브리드 E-tech iconic 상담 문의",
    });
    fireEvent.click(vehicleCard);

    expect(openEventConsult).toHaveBeenCalledTimes(1);
    expect(openEventConsult).toHaveBeenCalledWith({
      source: "/event",
      vehicleName: "르노코리아 필랑트",
      trimName: "하이브리드 E-tech iconic",
      monthlyPrice: "월 66만원",
      discount: "420만원",
    });
    expect(vehicleCard.closest('a[href="/cars"]')).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the other-vehicle action as a /cars link without consultation or dialog", () => {
    render(<EventConsultCard />);

    const link = screen.getByRole("link", { name: "다른 차량 견적 확인" });
    expect(link).toHaveAttribute("href", "/cars");

    link.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(link);

    expect(openEventConsult).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VehicleListItem } from "@/types/api";
import { FeaturedCarsSlider } from "./FeaturedCarsSlider";

type MockImageProps = ComponentProps<"img"> & {
  readonly fill?: boolean;
  readonly unoptimized?: boolean;
};

type MockMotionDivProps = ComponentProps<"div"> & {
  readonly initial?: unknown;
};

vi.mock("next/image", () => ({
  default: (props: MockImageProps) => (
    <span role="img" aria-label={props.alt} className={props.className} />
  ),
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: (props: MockMotionDivProps) => <div className={props.className}>{props.children}</div>,
  },
}));

const vehicle: VehicleListItem = {
  id: "vehicle-1",
  slug: "test-sedan",
  name: "테스트 세단",
  brand: "현대",
  category: "세단",
  basePrice: 40_000_000,
  evSubsidyRange: null,
  thumbnailUrl: "/test-sedan.webp",
  isPopular: true,
  description: null,
  displayOrder: 0,
  defaultTrim: null,
  monthlyFrom: 0,
  representativeQuotes: [],
  highlights: [],
  tags: ["#인기", "#세단"],
};

describe("FeaturedCarsSlider 반응형 카드", () => {
  it("태블릿부터 2장을 노출하면서 일반 차량과 같은 CarCard를 사용한다", () => {
    render(<FeaturedCarsSlider vehicles={[vehicle]} />);

    const vehicleLink = screen.getByRole("link", {
      name: /현대 테스트 세단 인기 현대 테스트 세단/,
    });
    const slide = vehicleLink.parentElement?.parentElement;
    const track = slide?.parentElement;

    expect(slide).toHaveClass(
      "w-full",
      "md:w-[calc(50%-6px)]",
      "lg:w-[calc(50%-8px)]",
    );
    expect(track).toHaveClass("gap-3", "lg:gap-4");
    expect(slide).not.toHaveClass("sm:w-[calc(50%-6px)]");
    expect(vehicleLink).toHaveClass("min-h-[180px]", "lg:min-h-[236px]");
    expect(screen.getByRole("heading", { name: "테스트 세단" })).toHaveClass(
      "text-[20px]",
      "lg:text-[24px]",
      "xl:text-[26px]",
    );
    expect(screen.queryByRole("link", { name: "AI 셀프 견적내기" })).not.toBeInTheDocument();
  });
});

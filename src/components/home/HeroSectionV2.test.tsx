import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeroSectionV2 } from "./HeroSectionV2";

describe("HeroSectionV2", () => {
  it("makes AI recommendation the first primary action", () => {
    // Given
    render(<HeroSectionV2 />);

    // When
    const aiRecommendationLink = screen.getByRole("link", {
      name: "AI 추천 받기",
    });
    const browseCarsLink = screen.getByRole("link", {
      name: "AI 셀프 견적내기",
    });

    // Then
    expect(
      aiRecommendationLink.compareDocumentPosition(browseCarsLink),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(aiRecommendationLink).toHaveClass("bg-brand", "text-white");
    expect(browseCarsLink).not.toHaveClass("bg-brand");
    expect(browseCarsLink).toHaveClass("cta-ai");
  });
});

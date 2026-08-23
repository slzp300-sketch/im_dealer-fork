import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReferralEntryCountdownBanner } from "./ReferralEntryCountdownBanner";

describe("ReferralEntryCountdownBanner", () => {
  it("잔여 일수가 있으면 D-day 라벨을 보여준다", () => {
    render(<ReferralEntryCountdownBanner remainingDays={14} />);
    expect(screen.getByText("추천인 코드 입력까지 D-14")).toBeInTheDocument();
    expect(
      screen.getByText("지금 입력하면 계약 완료 시 모바일 상품권 10만원을 드려요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "추천인 코드 입력하기" })).toHaveAttribute(
      "href",
      "/mypage/coupons",
    );
  });

  it("잔여 일수가 0이면 오늘 마감 문구를 보여준다", () => {
    render(<ReferralEntryCountdownBanner remainingDays={0} />);
    expect(screen.getByText("추천인 코드 입력이 오늘 마감돼요")).toBeInTheDocument();
  });
});

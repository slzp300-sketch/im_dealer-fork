import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReferredByCard } from "./ReferredByCard";

describe("ReferredByCard", () => {
  it("마스킹된 추천인 이름과 보유 쿠폰 상태를 보여준다", () => {
    render(
      <ReferredByCard
        referrerName="홍*동"
        coupon={{
          status: "HELD",
          title: "추천 가입 감사 상품권",
          rewardLabel: "모바일 상품권 10만원",
        }}
      />,
    );
    expect(screen.getByText("홍*동님의 추천으로 가입하셨어요")).toBeInTheDocument();
    expect(screen.getByText("모바일 상품권 10만원", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("보유")).toBeInTheDocument();
    expect(screen.getByText("계약 완료 시 지급돼요", { exact: false })).toBeInTheDocument();
  });

  it("쿠폰이 아직 없으면 쿠폰함 안내 문구를 보여준다", () => {
    render(<ReferredByCard referrerName="홍*동" coupon={null} />);
    expect(screen.getByText("추천 혜택은 쿠폰함에서 확인하세요.")).toBeInTheDocument();
  });

  it("지급 완료 쿠폰은 계약 안내 문구를 붙이지 않는다", () => {
    render(
      <ReferredByCard
        referrerName="홍*동"
        coupon={{
          status: "PAID",
          title: "추천 가입 감사 상품권",
          rewardLabel: "모바일 상품권 10만원",
        }}
      />,
    );
    expect(screen.getByText("지급 완료")).toBeInTheDocument();
    expect(
      screen.queryByText("계약 완료 시 지급돼요", { exact: false }),
    ).not.toBeInTheDocument();
  });
});

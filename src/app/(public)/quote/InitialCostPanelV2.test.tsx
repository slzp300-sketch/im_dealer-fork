import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InitialCostPanelV2 } from "./InitialCostPanelV2";
import type { QuoteScenarioDetail } from "@/types/quote";

const authMock = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock("@/hooks/useAuthUser", () => ({
  useAuthUser: () => ({ user: authMock.user, isLoading: false }),
}));

const scenario: QuoteScenarioDetail = {
  monthlyPayment: 530_000,
  depositAmount: 0,
  prepayAmount: 12_000_000,
  contractMonths: 60,
  annualMileage: 20_000,
  contractType: "반납형",
  bestFinanceCompany: "테스트캐피탈",
  purchaseSurcharge: 0,
  breakdown: {
    vehiclePrice: 40_000_000,
    baseMonthly: 700_000,
    depositDiscount: 0,
    prepayAdjust: -170_000,
    monthlyBeforeSurcharge: 530_000,
  } as QuoteScenarioDetail["breakdown"],
  surcharges: null,
  allFinanceResults: [],
};

function renderPanel(
  overrides: Partial<ComponentProps<typeof InitialCostPanelV2>> = {},
) {
  const props = {
    data: scenario,
    customRates: { depositRate: 0, prepayRate: 30 },
    onCustomRatesChange: vi.fn(),
    isRecalculating: false,
    costMode: "initial" as const,
    onCostModeChange: vi.fn(),
    onMemberLogin: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<InitialCostPanelV2 {...props} />);
  return props;
}

describe("InitialCostPanelV2", () => {
  beforeEach(() => {
    authMock.user = null;
  });

  it("places 있음 on the left and 없음 on the right, with 있음 selected first", () => {
    renderPanel();

    const hasInitial = screen.getByRole("button", { name: /초기 납부로 월납입 절감/ });
    const hasNone = screen.getByRole("button", { name: /보증금·선납금 없이 시작/ });
    expect(hasInitial.compareDocumentPosition(hasNone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hasInitial.className).toMatch(/ring-brand/);
    expect(screen.getAllByRole("button", { name: "30%" })[0]?.className).toMatch(/bg-brand/);
  });

  it("does not blur the prepay 30% result for guests", () => {
    renderPanel();

    expect(screen.getByText("초기비용 설정")).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "월 납입금을 낮추고 싶으시다면 로그인 해주세요",
    })).not.toBeInTheDocument();
  });

  it("shows the 80% 고객이 선택함 sticker and a green perk treatment on the guest 없음 card", () => {
    renderPanel();

    const hasNone = screen.getByRole("button", { name: /보증금·선납금 없이 시작/ });
    expect(screen.getByText("80% 고객이 선택함")).toBeInTheDocument();
    expect(hasNone.className).toMatch(/bg-status-positive-soft/);
    expect(hasNone.className).toMatch(/ring-status-positive/);

    const hasInitial = screen.getByRole("button", { name: /초기 납부로 월납입 절감/ });
    expect(hasInitial.className).toMatch(/ring-brand/);
  });

  it("hides the 80% 고객이 선택함 sticker and green perk from members", () => {
    authMock.user = { id: "member-1" };
    renderPanel();

    expect(screen.queryByText("80% 고객이 선택함")).not.toBeInTheDocument();
    const hasNone = screen.getByRole("button", { name: /보증금·선납금 없이 시작/ });
    expect(hasNone.className).toMatch(/bg-surface-soft/);
    expect(hasNone.className).not.toMatch(/bg-status-positive-soft/);
  });

  it("opens the login callback and does not change rates when a guest picks 없음 or another rate", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /보증금·선납금 없이 시작/ }));
    expect(props.onMemberLogin).toHaveBeenCalledTimes(1);
    expect(props.onCustomRatesChange).not.toHaveBeenCalled();
    expect(props.onCostModeChange).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
    expect(props.onMemberLogin).toHaveBeenCalledTimes(2);
    expect(props.onCustomRatesChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /보증금 계약 후 반환/ }));
    expect(props.onMemberLogin).toHaveBeenCalledTimes(3);
    expect(props.onCustomRatesChange).not.toHaveBeenCalled();
  });

  it("lets a member switch to no-deposit and other rates", () => {
    authMock.user = { id: "member-1" };
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: /보증금·선납금 없이 시작/ }));
    expect(props.onMemberLogin).not.toHaveBeenCalled();
    expect(props.onCustomRatesChange).toHaveBeenCalledWith({ depositRate: 0, prepayRate: 0 });
    expect(props.onCostModeChange).toHaveBeenCalledWith("none");
    expect(props.onReset).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "20%" })[0]!);
    expect(props.onCustomRatesChange).toHaveBeenCalledWith({ depositRate: 0, prepayRate: 20 });
  });
});

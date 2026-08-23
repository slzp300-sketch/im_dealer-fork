import { beforeEach, describe, expect, it, vi } from "vitest";
import { REFERRAL_ENTRY_WINDOW_DAYS } from "@/lib/referral/attribution";

const mocks = vi.hoisted(() => ({
  findMember: vi.fn(),
  findQuotes: vi.fn(),
  findVehicles: vi.fn(),
  findTrims: vi.fn(),
  findDeliveries: vi.fn(),
  findCoupons: vi.fn(),
  findReferral: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findMember },
    savedQuote: { findMany: mocks.findQuotes },
    vehicle: { findMany: mocks.findVehicles },
    trim: { findMany: mocks.findTrims },
    quoteDelivery: { findMany: mocks.findDeliveries },
    issuedCoupon: { findMany: mocks.findCoupons },
    referral: { findUnique: mocks.findReferral },
  },
}));

vi.mock("@/lib/coupons/reconcile", () => ({
  reconcileUserCoupons: vi.fn().mockResolvedValue(undefined),
}));

import { getMyPageData } from "./mypage";

describe("getMyPageData", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.findCoupons.mockResolvedValue([]);
    mocks.findReferral.mockResolvedValue(null);
  });

  it("현재 회원의 견적만 조회해 진행 중인 견적과 최근 전송 상태를 구성한다", async () => {
    const now = new Date("2026-07-24T03:00:00.000Z");
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      name: "홍길동",
      email: "hong@example.com",
      phone: "010-1234-5678",
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: true,
      consentedAt: now,
    });
    mocks.findQuotes.mockResolvedValue([
      {
        id: "quote-active",
        sessionId: "session-active",
        vehicleId: "vehicle-1",
        trimId: "trim-1",
        contractMonths: 48,
        annualMileage: 20_000,
        depositRate: 10,
        prepayRate: 0,
        contractType: "반납형",
        customerType: "individual",
        monthlyPayment: 560_000,
        pricingStatus: "CALCULATED",
        breakdown: {
          productType: "리스",
          vehicleName: "쏘렌토 견적 당시 모델",
          vehicleBrand: "기아",
          trimName: "시그니처 견적 당시 트림",
          selectedOptions: [{ id: "option-1", name: "드라이브 와이즈", price: 1_290_000 }],
          exteriorColor: { name: "스노우 화이트 펄", priceDelta: 80_000 },
          interiorColor: { name: "블랙", priceDelta: 0 },
          totalVehiclePrice: 46_720_000,
        },
        status: "CONTACTED",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
      {
        id: "quote-converted",
        sessionId: "session-converted",
        vehicleId: "vehicle-2",
        trimId: "trim-2",
        contractMonths: 60,
        annualMileage: 10_000,
        depositRate: 0,
        prepayRate: 0,
        contractType: "반납형",
        customerType: "individual",
        monthlyPayment: 480_000,
        pricingStatus: "CALCULATED",
        breakdown: {},
        status: "CONVERTED",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    ]);
    mocks.findVehicles.mockResolvedValue([
      { id: "vehicle-1", slug: "sorento", name: "쏘렌토 현재 모델", brand: "기아", thumbnailUrl: "/sorento.png" },
      { id: "vehicle-2", slug: "ev6", name: "EV6", brand: "기아", thumbnailUrl: "/ev6.png" },
    ]);
    mocks.findTrims.mockResolvedValue([
      { id: "trim-1", name: "시그니처 현재 트림" },
      { id: "trim-2", name: "에어" },
    ]);
    mocks.findDeliveries.mockResolvedValue([
      {
        savedQuoteId: "quote-active",
        status: "SENT",
        createdAt: now,
        sentAt: now,
      },
    ]);

    const result = await getMyPageData("supabase-member-1");

    expect(mocks.findQuotes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "supabase-member-1", deletedAt: null },
      })
    );
    expect(result.activeQuote).toMatchObject({
      id: "quote-active",
      sessionId: "session-active",
      vehicleName: "쏘렌토 견적 당시 모델",
      trimName: "시그니처 견적 당시 트림",
      productType: "리스",
      selectedOptionIds: ["option-1"],
      selectedOptions: [{ id: "option-1", name: "드라이브 와이즈", price: 1_290_000 }],
      exteriorColor: { name: "스노우 화이트 펄", priceDelta: 80_000 },
      interiorColor: { name: "블랙", priceDelta: 0 },
      totalVehiclePrice: 46_720_000,
      statusInfo: { label: "상담 진행" },
      delivery: { status: "SENT" },
    });
    expect(result.quotes).toHaveLength(2);
  });

  it("만료된 견적은 목록에는 남기되 '진행 중' 견적으로 승격하지 않는다", async () => {
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24);
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-1",
      name: "홍길동",
      email: null,
      phone: null,
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: false,
      consentedAt: null,
      profileCompleted: true,
    });
    mocks.findQuotes.mockResolvedValue([
      {
        id: "quote-expired",
        sessionId: "session-expired",
        vehicleId: "vehicle-1",
        trimId: "trim-1",
        contractMonths: 48,
        annualMileage: 20_000,
        depositRate: 0,
        prepayRate: 0,
        contractType: "반납형",
        customerType: "individual",
        monthlyPayment: 560_000,
        pricingStatus: "CALCULATED",
        breakdown: {},
        status: "NEW",
        createdAt: past,
        updatedAt: past,
        expiresAt: past,
      },
    ]);
    mocks.findVehicles.mockResolvedValue([
      { id: "vehicle-1", slug: "sorento", name: "쏘렌토", brand: "기아", thumbnailUrl: null },
    ]);
    mocks.findTrims.mockResolvedValue([{ id: "trim-1", name: "시그니처" }]);
    mocks.findDeliveries.mockResolvedValue([]);

    const result = await getMyPageData("sb-1");

    expect(result.quotes).toHaveLength(1);
    expect(result.activeQuote).toBeNull();
  });

  it("회원 행이 없어도 빈 마이페이지를 안전하게 반환한다", async () => {
    mocks.findMember.mockResolvedValue(null);
    mocks.findQuotes.mockResolvedValue([]);
    mocks.findVehicles.mockResolvedValue([]);
    mocks.findTrims.mockResolvedValue([]);

    const result = await getMyPageData("supabase-member-without-profile");

    expect(result).toEqual({
      profile: {
        name: "고객",
        email: null,
        phone: null,
        provider: null,
        channelRelation: null,
        marketingConsent: false,
        consentedAt: null,
      },
      quotes: [],
      activeQuote: null,
      couponSummary: { heldCount: 0, pendingCount: 0, totalAmount: 0 },
      referralEntry: null,
      referredBy: null,
    });
    expect(mocks.findDeliveries).not.toHaveBeenCalled();
    expect(mocks.findCoupons).not.toHaveBeenCalled();
    expect(mocks.findReferral).not.toHaveBeenCalled();
  });

  it("보유·지급예정 쿠폰을 요약해 함께 돌려준다", async () => {
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-1",
      name: "홍길동",
      email: null,
      phone: null,
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: false,
      consentedAt: null,
      profileCompleted: true,
    });
    mocks.findQuotes.mockResolvedValue([]);
    mocks.findVehicles.mockResolvedValue([]);
    mocks.findTrims.mockResolvedValue([]);
    mocks.findDeliveries.mockResolvedValue([]);
    mocks.findCoupons.mockResolvedValue([
      { status: "HELD", rewardAmountSnapshot: 100_000 },
      { status: "PENDING", rewardAmountSnapshot: 300_000 },
    ]);

    const data = await getMyPageData("sb-1");

    expect(data.couponSummary).toEqual({
      heldCount: 1,
      pendingCount: 1,
      totalAmount: 400_000,
    });
  });

  it("추천 코드 미입력·창구 안 회원에게는 잔여 일수를 돌려준다", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-1",
      name: "홍길동",
      email: null,
      phone: null,
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: false,
      consentedAt: null,
      profileCompleted: true,
      profileCompletedAt: new Date(Date.now() - 2 * dayMs),
    });
    mocks.findQuotes.mockResolvedValue([]);
    mocks.findVehicles.mockResolvedValue([]);
    mocks.findTrims.mockResolvedValue([]);
    mocks.findDeliveries.mockResolvedValue([]);

    const data = await getMyPageData("sb-1");

    expect(data.referralEntry).toEqual({
      remainingDays: REFERRAL_ENTRY_WINDOW_DAYS - 2,
    });
    expect(data.referredBy).toBeNull();
  });

  it("창구가 지난 미인정 회원에게는 배너 데이터를 주지 않는다", async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-1",
      name: "홍길동",
      email: null,
      phone: null,
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: false,
      consentedAt: null,
      profileCompleted: true,
      profileCompletedAt: new Date(
        Date.now() - (REFERRAL_ENTRY_WINDOW_DAYS + 1) * dayMs,
      ),
    });
    mocks.findQuotes.mockResolvedValue([]);
    mocks.findVehicles.mockResolvedValue([]);
    mocks.findTrims.mockResolvedValue([]);
    mocks.findDeliveries.mockResolvedValue([]);

    const data = await getMyPageData("sb-1");

    expect(data.referralEntry).toBeNull();
    expect(data.referredBy).toBeNull();
  });

  it("추천으로 가입한 회원에게는 마스킹된 추천인과 쿠폰 상태를 돌려준다", async () => {
    mocks.findMember.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-1",
      name: "김철수",
      email: null,
      phone: null,
      provider: "kakao",
      channelRelation: "ADDED",
      marketingConsent: false,
      consentedAt: null,
      profileCompleted: true,
      profileCompletedAt: new Date(),
    });
    mocks.findQuotes.mockResolvedValue([]);
    mocks.findVehicles.mockResolvedValue([]);
    mocks.findTrims.mockResolvedValue([]);
    mocks.findDeliveries.mockResolvedValue([]);
    mocks.findReferral.mockResolvedValue({
      referrer: { name: "홍길동" },
      coupons: [
        {
          status: "HELD",
          titleSnapshot: "추천 가입 감사 상품권",
          rewardLabelSnapshot: "모바일 상품권 10만원",
          rewardAmountSnapshot: 100_000,
        },
      ],
    });

    const data = await getMyPageData("sb-1");

    expect(data.referredBy).toEqual({
      referrerName: "홍*동",
      coupon: {
        status: "HELD",
        title: "추천 가입 감사 상품권",
        rewardLabel: "모바일 상품권 10만원",
        rewardAmount: 100_000,
      },
    });
    // 추천이 인정된 회원에게는 사후 입력 배너를 띄우지 않는다.
    expect(data.referralEntry).toBeNull();
  });
});

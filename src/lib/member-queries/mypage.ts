import { type CouponStatus, type Prisma, type QuoteStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCouponSummary, type CouponBoxSummary } from "@/lib/member-queries/coupons";
import {
  isReferralEntryWindowOpen,
  referralEntryRemainingDays,
} from "@/lib/referral/attribution";
import { maskName } from "@/lib/referral/progress";

export type MyPageStatusTone = "neutral" | "info" | "warning" | "positive" | "danger";

export interface MyPageQuoteStatus {
  label: string;
  description: string;
  tone: MyPageStatusTone;
  progressIndex: number;
}

export interface MyPageQuoteDelivery {
  status: "PENDING" | "SENT" | "FAILED";
  createdAt: Date;
  sentAt: Date | null;
}

export interface MyPageQuoteOption {
  id: string | null;
  name: string;
  price: number;
}

export interface MyPageQuoteColor {
  name: string;
  priceDelta: number;
}

export interface MyPageQuote {
  id: string;
  sessionId: string;
  vehicleSlug: string | null;
  vehicleName: string;
  vehicleBrand: string | null;
  thumbnailUrl: string | null;
  trimId: string;
  trimName: string;
  selectedOptionIds: string[];
  selectedOptions: MyPageQuoteOption[];
  exteriorColor: MyPageQuoteColor | null;
  interiorColor: MyPageQuoteColor | null;
  totalVehiclePrice: number | null;
  productType: "장기렌트" | "리스";
  contractType: string;
  customerType: string;
  contractMonths: number;
  annualMileage: number;
  depositRate: number;
  prepayRate: number;
  monthlyPayment: number;
  pricingStatus: "CALCULATED" | "CONSULTATION_REQUIRED";
  status: QuoteStatus;
  statusInfo: MyPageQuoteStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  delivery: MyPageQuoteDelivery | null;
}

export interface MyPageProfile {
  name: string;
  email: string | null;
  phone: string | null;
  provider: string | null;
  channelRelation: string | null;
  marketingConsent: boolean;
  consentedAt: Date | null;
}

export interface MyPageReferralEntry {
  /** 사후 입력 창구 잔여 일수. 0이면 오늘 마감 */
  remainingDays: number;
}

export interface MyPageReferredByCoupon {
  status: CouponStatus;
  title: string;
  rewardLabel: string;
  rewardAmount: number | null;
}

export interface MyPageReferredBy {
  /** 마스킹된 추천인 이름 (예: 김*규) */
  referrerName: string;
  /** REFERRAL_RECEIVED 쿠폰 스냅샷. 정책 부재로 미발급이면 null */
  coupon: MyPageReferredByCoupon | null;
}

export interface MyPageData {
  profile: MyPageProfile;
  quotes: MyPageQuote[];
  activeQuote: MyPageQuote | null;
  couponSummary: CouponBoxSummary;
  /** 추천인 코드 사후 입력 배너 — 창구 안·미인정 회원일 때만 */
  referralEntry: MyPageReferralEntry | null;
  /** 추천으로 가입한 회원의 귀속 정보 — 미인정이면 null */
  referredBy: MyPageReferredBy | null;
}

const STATUS_INFO: Record<QuoteStatus, MyPageQuoteStatus> = {
  NEW: {
    label: "견적 접수",
    description: "선택한 조건을 확인하고 상담을 이어갈 수 있어요.",
    tone: "info",
    progressIndex: 0,
  },
  CONTACTED: {
    label: "상담 진행",
    description: "담당자와 조건을 조율하고 있어요.",
    tone: "warning",
    progressIndex: 1,
  },
  IN_PROGRESS: {
    label: "심사·계약 진행",
    description: "안내받은 절차를 이어서 진행해 주세요.",
    tone: "warning",
    progressIndex: 2,
  },
  CONVERTED: {
    label: "계약 완료",
    description: "계약이 완료된 견적이에요.",
    tone: "positive",
    progressIndex: 3,
  },
  LOST: {
    label: "진행 종료",
    description: "필요할 때 같은 조건으로 새 견적을 받아보세요.",
    tone: "neutral",
    progressIndex: -1,
  },
};

type JsonRecord = Record<string, Prisma.JsonValue>;

function isJsonRecord(value: Prisma.JsonValue): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Prisma.JsonValue, key: string): string | null {
  if (!isJsonRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function readNumber(value: Prisma.JsonValue, key: string): number | null {
  if (!isJsonRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function readSelectedOptionIds(value: Prisma.JsonValue): string[] {
  if (!isJsonRecord(value)) return [];
  const selectedOptions = value.selectedOptions;
  if (!Array.isArray(selectedOptions)) return [];

  return selectedOptions.flatMap((option) => {
    if (!isJsonRecord(option)) return [];
    const id = option.id;
    return typeof id === "string" && id ? [id] : [];
  });
}

function readSelectedOptions(value: Prisma.JsonValue): MyPageQuoteOption[] {
  if (!isJsonRecord(value)) return [];
  const selectedOptions = value.selectedOptions;
  if (!Array.isArray(selectedOptions)) return [];

  return selectedOptions.flatMap((option) => {
    if (!isJsonRecord(option)) return [];
    const name = typeof option.name === "string" && option.name.trim() ? option.name.trim() : null;
    if (!name) return [];

    return [{
      id: typeof option.id === "string" && option.id ? option.id : null,
      name,
      price: typeof option.price === "number" && Number.isFinite(option.price) ? option.price : 0,
    }];
  });
}

function readColor(value: Prisma.JsonValue, key: "exteriorColor" | "interiorColor"): MyPageQuoteColor | null {
  if (!isJsonRecord(value)) return null;
  const color = value[key];
  if (!isJsonRecord(color)) return null;

  const name = typeof color.name === "string" && color.name.trim() ? color.name.trim() : null;
  if (!name) return null;

  return {
    name,
    priceDelta: typeof color.priceDelta === "number" && Number.isFinite(color.priceDelta)
      ? color.priceDelta
      : 0,
  };
}

function readProductType(value: Prisma.JsonValue): "장기렌트" | "리스" {
  return readString(value, "productType") === "리스" ? "리스" : "장기렌트";
}

function toDeliveryStatus(status: string): MyPageQuoteDelivery["status"] {
  if (status === "SENT" || status === "FAILED") return status;
  return "PENDING";
}

function chooseActiveQuote(quotes: MyPageQuote[]): MyPageQuote | null {
  // 만료된 견적을 '진행 중'으로 승격하면 옛 월납이 유효 견적처럼 크게 노출된다.
  const now = Date.now();
  return quotes.find(
    (quote) =>
      quote.status !== "CONVERTED" &&
      quote.status !== "LOST" &&
      quote.expiresAt.getTime() > now
  ) ?? null;
}

export async function getMyPageData(supabaseId: string): Promise<MyPageData> {
  const [member, savedQuotes] = await Promise.all([
    prisma.user.findUnique({
      where: { supabaseId },
      select: {
        id: true,
        supabaseId: true,
        profileCompleted: true,
        profileCompletedAt: true,
        name: true,
        email: true,
        phone: true,
        provider: true,
        channelRelation: true,
        marketingConsent: true,
        consentedAt: true,
      },
    }),
    prisma.savedQuote.findMany({
      where: { userId: supabaseId, deletedAt: null },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 20,
      select: {
        id: true,
        sessionId: true,
        vehicleId: true,
        trimId: true,
        contractMonths: true,
        annualMileage: true,
        depositRate: true,
        prepayRate: true,
        contractType: true,
        customerType: true,
        monthlyPayment: true,
        pricingStatus: true,
        breakdown: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  const vehicleIds = [...new Set(savedQuotes.map((quote) => quote.vehicleId))];
  const trimIds = [...new Set(savedQuotes.map((quote) => quote.trimId))];
  const quoteIds = savedQuotes.map((quote) => quote.id);

  const [vehicles, trims, deliveries, referral] = await Promise.all([
    vehicleIds.length > 0
      ? prisma.vehicle.findMany({
          where: { id: { in: vehicleIds } },
          select: { id: true, slug: true, name: true, brand: true, thumbnailUrl: true },
        })
      : [],
    trimIds.length > 0
      ? prisma.trim.findMany({
          where: { id: { in: trimIds } },
          select: { id: true, name: true },
        })
      : [],
    member && quoteIds.length > 0
      ? prisma.quoteDelivery.findMany({
          where: { userId: member.id, savedQuoteId: { in: quoteIds } },
          orderBy: { createdAt: "desc" },
          select: { savedQuoteId: true, status: true, createdAt: true, sentAt: true },
        })
      : [],
    member
      ? prisma.referral.findUnique({
          where: { refereeId: member.id },
          select: {
            referrer: { select: { name: true } },
            coupons: {
              where: { policy: { trigger: "REFERRAL_RECEIVED" } },
              // 정책이 여러 개면 쿠폰도 여러 장 발급된다 — 카드에는 최신 1장만 표시
              orderBy: { issuedAt: "desc" },
              select: {
                status: true,
                titleSnapshot: true,
                rewardLabelSnapshot: true,
                rewardAmountSnapshot: true,
              },
              take: 1,
            },
          },
        })
      : null,
  ]);

  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const trimMap = new Map(trims.map((trim) => [trim.id, trim]));
  const latestDeliveryByQuoteId = new Map<string, MyPageQuoteDelivery>();
  for (const delivery of deliveries) {
    if (!delivery.savedQuoteId || latestDeliveryByQuoteId.has(delivery.savedQuoteId)) continue;
    latestDeliveryByQuoteId.set(delivery.savedQuoteId, {
      status: toDeliveryStatus(delivery.status),
      createdAt: delivery.createdAt,
      sentAt: delivery.sentAt,
    });
  }

  const quotes: MyPageQuote[] = savedQuotes.map((quote) => {
    const vehicle = vehicleMap.get(quote.vehicleId);
    const trim = trimMap.get(quote.trimId);
    const vehicleName = readString(quote.breakdown, "vehicleName") ?? vehicle?.name ?? "선택한 차량";

    return {
      id: quote.id,
      sessionId: quote.sessionId,
      vehicleSlug: vehicle?.slug ?? null,
      vehicleName,
      vehicleBrand: readString(quote.breakdown, "vehicleBrand") ?? vehicle?.brand ?? null,
      thumbnailUrl: vehicle?.thumbnailUrl ?? null,
      trimId: quote.trimId,
      trimName: readString(quote.breakdown, "trimName") ?? trim?.name ?? "선택한 트림",
      selectedOptionIds: readSelectedOptionIds(quote.breakdown),
      selectedOptions: readSelectedOptions(quote.breakdown),
      exteriorColor: readColor(quote.breakdown, "exteriorColor"),
      interiorColor: readColor(quote.breakdown, "interiorColor"),
      totalVehiclePrice: readNumber(quote.breakdown, "totalVehiclePrice"),
      productType: readProductType(quote.breakdown),
      contractType: quote.contractType,
      customerType: quote.customerType,
      contractMonths: quote.contractMonths,
      annualMileage: quote.annualMileage,
      depositRate: quote.depositRate,
      prepayRate: quote.prepayRate,
      monthlyPayment: quote.monthlyPayment,
      pricingStatus: quote.pricingStatus,
      status: quote.status,
      statusInfo: STATUS_INFO[quote.status],
      createdAt: quote.createdAt,
      updatedAt: quote.updatedAt,
      expiresAt: quote.expiresAt,
      delivery: latestDeliveryByQuoteId.get(quote.id) ?? null,
    };
  });

  // getCouponSummary 내부는 이미 reconcile 실패를 삼키지만, 조회 자체의 실패까지
  // 마이페이지 렌더를 막지 않도록 한 번 더 감싼다.
  const couponSummary: CouponBoxSummary = member?.supabaseId
    ? await getCouponSummary({
        id: member.id,
        supabaseId: member.supabaseId,
        profileCompleted: member.profileCompleted,
      }).catch((error: unknown) => {
        console.error("[mypage] 쿠폰 요약 조회 실패:", error);
        return { heldCount: 0, pendingCount: 0, totalAmount: 0 };
      })
    : { heldCount: 0, pendingCount: 0, totalAmount: 0 };

  // 배너(미인정·창구 안)와 추천인 카드(인정됨)는 상호 배타다.
  const referralEntry: MyPageReferralEntry | null =
    member?.profileCompleted &&
    member.profileCompletedAt &&
    !referral &&
    isReferralEntryWindowOpen(member.profileCompletedAt)
      ? { remainingDays: referralEntryRemainingDays(member.profileCompletedAt) }
      : null;

  const referredBy: MyPageReferredBy | null = referral
    ? {
        referrerName: maskName(referral.referrer.name),
        coupon: referral.coupons[0]
          ? {
              status: referral.coupons[0].status,
              title: referral.coupons[0].titleSnapshot,
              rewardLabel: referral.coupons[0].rewardLabelSnapshot,
              rewardAmount: referral.coupons[0].rewardAmountSnapshot,
            }
          : null,
      }
    : null;

  return {
    profile: {
      name: member?.name || "고객",
      email: member?.email ?? null,
      phone: member?.phone ?? null,
      provider: member?.provider ?? null,
      channelRelation: member?.channelRelation ?? null,
      marketingConsent: member?.marketingConsent ?? false,
      consentedAt: member?.consentedAt ?? null,
    },
    quotes,
    activeQuote: chooseActiveQuote(quotes),
    couponSummary,
    referralEntry,
    referredBy,
  };
}

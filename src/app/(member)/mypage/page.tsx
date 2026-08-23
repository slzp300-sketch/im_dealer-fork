import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Gift,
  Ticket,
  UserRound,
  Users,
} from "lucide-react";
import { ReferralEntryCountdownBanner } from "@/components/mypage/ReferralEntryCountdownBanner";
import { ReferredByCard } from "@/components/mypage/ReferredByCard";
import { getMyPageData } from "@/lib/member-queries/mypage";
import { requireMember } from "@/lib/require-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "마이페이지",
  description: "견적, 쿠폰, 추천인, 내 정보를 확인하세요.",
  robots: { index: false, follow: false, nocache: true },
};

const HUB_LINKS = [
  {
    href: "/mypage/quotes",
    label: "내 견적보기",
    description: "저장한 견적과 상담 진행 상황",
    icon: Ticket,
  },
  {
    href: "/mypage/coupons",
    label: "쿠폰함",
    description: "받을 혜택과 지급 상태",
    icon: Gift,
  },
  {
    href: "/mypage/referral",
    label: "추천인",
    description: "고유 링크·코드로 친구 초대",
    icon: Users,
  },
  {
    href: "/mypage/profile",
    label: "내 정보",
    description: "계정·연락처·마케팅 동의",
    icon: UserRound,
  },
] as const;

export default async function MyPageHub() {
  const access = await requireMember();
  if (!access.userId) redirect("/login");

  const data = await getMyPageData(access.userId);

  return (
    <>
      {data.referredBy ? (
        <ReferredByCard
          referrerName={data.referredBy.referrerName}
          coupon={data.referredBy.coupon}
        />
      ) : data.referralEntry ? (
        <ReferralEntryCountdownBanner
          remainingDays={data.referralEntry.remainingDays}
        />
      ) : null}

      <section className="mb-7 md:mb-9">
        <p className="mb-2 text-[13px] font-extrabold text-brand">MY PAGE</p>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-text-strong md:text-[36px]">
          {data.profile.name}님, 안녕하세요
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-text-body">
          원하시는 메뉴를 선택해 주세요.
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2" aria-label="마이 메뉴">
        {HUB_LINKS.map(({ href, label, description, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-start gap-3 rounded-card border border-border-subtle bg-surface p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand/30 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-brand-soft text-brand">
              <Icon size={20} strokeWidth={2.1} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-extrabold text-text-strong">{label}</h2>
                <ArrowRight
                  size={16}
                  className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand"
                />
              </div>
              <p className="mt-1 text-[13px] leading-5 text-text-body">{description}</p>
              {href === "/mypage/quotes" && data.quotes.length > 0 ? (
                <p className="mt-2 text-[12px] font-bold text-brand">
                  저장 견적 {data.quotes.length}건
                </p>
              ) : null}
              {href === "/mypage/coupons" && data.couponSummary.heldCount + data.couponSummary.pendingCount > 0 ? (
                <p className="mt-2 text-[12px] font-bold text-brand">
                  보유·지급예정{" "}
                  {data.couponSummary.heldCount + data.couponSummary.pendingCount}장
                </p>
              ) : null}
            </div>
          </Link>
        ))}
      </section>
    </>
  );
}

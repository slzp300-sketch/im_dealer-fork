import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Ticket } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { CouponTicket } from "@/components/mypage/CouponTicket";
import { ReferralCodeEntryCard } from "@/components/mypage/ReferralCodeEntryCard";
import { getCouponBoxData } from "@/lib/member-queries/coupons";
import { prisma } from "@/lib/prisma";
import { formatWonShort } from "@/lib/utils";
import {
  isReferralEntryWindowOpen,
  referralEntryDeadline,
} from "@/lib/referral/attribution";
import { formatKstDate } from "@/lib/referral/progress";
import { requireMember } from "@/lib/require-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "쿠폰함",
  description: "받으실 혜택과 지급 상태를 확인하세요.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function CouponBoxPage() {
  const access = await requireMember();
  if (!access.userId) redirect("/login");

  const { available, past, summary } = await getCouponBoxData(access.userId);
  const hasAny = available.length > 0 || past.length > 0;

  // 가입 때 추천인 코드를 깜빡한 회원의 사후 입력 카드.
  // 자격: 가입 완료 + 창구(14일) 이내 + 아직 추천 미인정.
  let referralEntryDeadlineLabel: string | null = null;
  const member = await prisma.user.findFirst({
    where: { supabaseId: access.userId },
    select: { id: true, profileCompleted: true, profileCompletedAt: true },
  });
  if (
    member?.profileCompleted &&
    member.profileCompletedAt &&
    isReferralEntryWindowOpen(member.profileCompletedAt)
  ) {
    const alreadyReferred = await prisma.referral.findUnique({
      where: { refereeId: member.id },
      select: { id: true },
    });
    if (!alreadyReferred) {
      referralEntryDeadlineLabel = formatKstDate(
        referralEntryDeadline(member.profileCompletedAt),
      );
    }
  }

  return (
    <>
      <section className="mb-6">
        <p className="mb-2 text-[13px] font-extrabold text-brand">MY COUPON</p>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-text-strong md:text-[34px]">
          쿠폰함
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-text-body">
          받으실 혜택과 지급 상태를 한곳에서 확인하세요.
        </p>
      </section>

      <section className="mb-8 grid grid-cols-3 gap-2.5" aria-label="쿠폰 요약">
        <SummaryTile label="보유" value={`${summary.heldCount}장`} emphasis />
        <SummaryTile label="지급 예정" value={`${summary.pendingCount}장`} />
        <SummaryTile
          label="받을 혜택"
          value={formatWonShort(summary.totalAmount)}
          note="계약 완료 시 지급"
        />
      </section>

      {referralEntryDeadlineLabel ? (
        <ReferralCodeEntryCard deadlineLabel={referralEntryDeadlineLabel} />
      ) : null}

      {hasAny ? (
        <>
          {available.length > 0 && (
            <section
              className="mb-9"
              aria-labelledby="available-coupons-heading"
            >
              <h2
                id="available-coupons-heading"
                className="mb-3 text-[17px] font-extrabold text-text-strong"
              >
                사용 가능
              </h2>
              <div className="grid gap-3 md:grid-cols-2 md:gap-4">
                {available.map((coupon) => (
                  <CouponTicket key={coupon.id} coupon={coupon} />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <details className="mb-9 group">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[17px] font-extrabold text-text-strong">
                지난 쿠폰
                <span className="rounded-pill bg-surface-soft px-2.5 py-1 text-[12px] font-extrabold text-text-body">
                  {past.length}
                </span>
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2 md:gap-4">
                {past.map((coupon) => (
                  <CouponTicket key={coupon.id} coupon={coupon} />
                ))}
              </div>
            </details>
          )}
        </>
      ) : (
        <EmptyState
          icon={<Ticket size={28} strokeWidth={1.8} />}
          title="아직 받은 쿠폰이 없어요"
          description="회원가입과 첫 계약에는 축하 혜택이 준비되어 있어요. 차량을 먼저 둘러보세요."
          action={
            <Link
              href="/cars"
              className="inline-flex min-h-11 items-center justify-center rounded-btn bg-brand px-4 text-[13px] font-extrabold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              차량 둘러보기
            </Link>
          }
        />
      )}

      <section className="rounded-card border border-border-subtle bg-surface-soft p-4 text-[13px] leading-6 text-text-body">
        <p className="mb-1 font-extrabold text-text-strong">쿠폰 안내</p>
        <ul className="list-disc pl-4">
          <li>쿠폰은 계약 완료 후 영업담당자 확인을 거쳐 순차 지급돼요.</li>
          <li>쿠폰별 유효기간이 지나면 자동으로 만료돼요.</li>
          <li>
            쿠폰 코드는 문의 시 확인용이며 다른 계정으로 양도할 수 없어요.
          </li>
        </ul>
      </section>
    </>
  );
}

function SummaryTile({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border p-3.5 ${
        emphasis
          ? "border-brand/25 bg-brand-soft"
          : "border-border-subtle bg-surface"
      }`}
    >
      <p
        className={`whitespace-nowrap text-[12px] font-bold ${emphasis ? "text-brand" : "text-text-muted"}`}
      >
        {label}
      </p>
      <p
        className={`mt-1 break-keep tabular-nums text-[16px] font-extrabold md:text-[18px] ${
          emphasis ? "text-brand" : "text-text-strong"
        }`}
      >
        {value}
      </p>
      {note && (
        <p className="mt-1 text-[11px] font-semibold text-text-muted">{note}</p>
      )}
    </div>
  );
}

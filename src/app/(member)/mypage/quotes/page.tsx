import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CarFront, Sparkles, ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { AiBadgeIcon } from "@/components/ui/AiBadgeIcon";
import { ActiveQuoteSection } from "@/components/mypage/ActiveQuoteSection";
import { QuoteCard } from "@/components/mypage/QuoteCard";
import { getMyPageData } from "@/lib/member-queries/mypage";
import { requireMember } from "@/lib/require-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "내 견적",
  description: "저장한 견적과 상담 진행 상황을 확인하세요.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function MyQuotesPage() {
  const access = await requireMember();
  if (!access.userId) redirect("/login");

  const data = await getMyPageData(access.userId);

  return (
    <>
      <section className="mb-6">
        <p className="mb-2 text-[13px] font-extrabold text-brand">MY QUOTES</p>
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-text-strong md:text-[34px]">
          내 견적
        </h1>
        <p className="mt-2 text-[15px] leading-6 text-text-body">
          저장한 견적을 확인하고 상담을 이어가세요.
        </p>
      </section>

      {data.activeQuote ? (
        <ActiveQuoteSection quote={data.activeQuote} />
      ) : (
        <section className="mb-8 rounded-card-lg border border-border-subtle bg-surface-raised p-5 shadow-card md:p-7">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-brand-soft text-brand">
              <Sparkles size={21} strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <p className="text-[17px] font-extrabold text-text-strong">
                내 조건에 맞는 차량을 찾아볼까요?
              </p>
              <p className="mt-1 text-[14px] leading-6 text-text-body">
                차량을 고르고 월 납입금과 계약 조건을 비교해 보세요.
              </p>
              <Link
                href="/cars"
                className="cta-ai mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-btn px-4 text-[13px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <AiBadgeIcon className="h-[14px] w-auto shrink-0" />
                셀프 견적내기
                <ArrowRight size={15} strokeWidth={2.4} />
              </Link>
            </div>
          </div>
        </section>
      )}

      <section className="mb-6" aria-labelledby="my-quotes-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2
            id="my-quotes-heading"
            className="text-[20px] font-extrabold text-text-strong md:text-[22px]"
          >
            견적 목록
          </h2>
          {data.quotes.length > 0 && (
            <span className="rounded-pill bg-surface-soft px-3 py-1.5 text-[12px] font-extrabold text-text-body">
              총 {data.quotes.length}건
            </span>
          )}
        </div>

        {data.quotes.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 md:gap-4">
            {data.quotes.map((quote) => (
              <QuoteCard key={quote.id} quote={quote} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<CarFront size={28} strokeWidth={1.8} />}
            title="아직 저장한 견적이 없어요"
            description="차량을 고른 뒤 조건을 설정하면 언제든 이곳에서 다시 확인할 수 있어요."
            action={
              <Link
                href="/recommend"
                className="inline-flex min-h-11 items-center justify-center rounded-btn bg-brand px-4 text-[13px] font-extrabold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                AI 추천 시작하기
              </Link>
            }
          />
        )}
      </section>
    </>
  );
}

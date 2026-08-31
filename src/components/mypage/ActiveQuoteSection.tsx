import { Clock3, Send } from "lucide-react";
import { QuoteConditionDialog } from "@/components/mypage/QuoteConditionDialog";
import { MyPageConsultationButton } from "@/components/mypage/MyPageConsultationButton";
import { productTypeLabel } from "@/constants/product-type";
import type { MyPageQuote } from "@/lib/member-queries/mypage";
import {
  dateFormatter,
  formatMileage,
  getDeliveryLabel,
  getExpiryLabel,
  getQuoteHref,
  moneyFormatter,
  statusToneClasses,
} from "@/lib/member-queries/mypage-format";

export function ActiveQuoteSection({ quote }: { quote: MyPageQuote }) {
  const quoteHref = getQuoteHref(quote);
  const deliveryLabel = getDeliveryLabel(quote);

  return (
    <section
      className="mb-10 overflow-hidden rounded-card-lg border border-brand/20 bg-surface-raised shadow-mobile-float md:mb-12"
      aria-labelledby="active-quote-heading"
    >
      <div className="bg-gradient-to-br from-brand to-brand-dark px-5 py-5 text-white md:px-7 md:py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold text-white/75">현재 진행 중인 견적</p>
            <h2 id="active-quote-heading" className="mt-1 text-[22px] font-extrabold text-white tracking-[-0.02em] md:text-[26px]">
              {quote.vehicleBrand ? `${quote.vehicleBrand} ` : ""}{quote.vehicleName}
            </h2>
          </div>
          <StatusPill quote={quote} inverse />
        </div>
        <p className="mt-2 text-[14px] font-medium text-white/80">{quote.trimName} · {productTypeLabel(quote.productType)} · {quote.contractMonths}개월</p>
      </div>

      <div className="p-5 md:grid md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] md:gap-7 md:p-7">
        <div>
          <p className="text-[13px] font-bold text-text-muted">현재 상태</p>
          <p className="mt-1 text-[19px] font-extrabold text-text-strong">{quote.statusInfo.label}</p>
          <p className="mt-1 text-[14px] leading-6 text-text-body">{quote.statusInfo.description}</p>

          <ProgressSteps currentIndex={quote.statusInfo.progressIndex} status={quote.status} />

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Metric label="월 납입금" value={quote.pricingStatus === "CALCULATED" ? `${moneyFormatter.format(quote.monthlyPayment)}원` : "상담 확인"} emphasis />
            <Metric label="약정 거리" value={`연 ${formatMileage(quote.annualMileage)}`} />
            <Metric label="보증금" value={`${quote.depositRate}%`} />
            <Metric label="선납금" value={`${quote.prepayRate}%`} />
          </div>
        </div>

        <aside className="mt-5 rounded-card border border-border-subtle bg-surface-soft p-4 md:mt-0">
          <div className="flex items-center gap-2 text-[13px] font-bold text-text-body">
            <Clock3 size={15} strokeWidth={2.2} className="text-brand" />
            견적 {getExpiryLabel(quote.expiresAt)}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-text-muted">
            마지막 업데이트 {dateFormatter.format(quote.updatedAt)}
          </p>
          <div className="mt-4 grid gap-2">
            <QuoteConditionDialog
              quote={quote}
              quoteHref={quoteHref}
              label="견적 조건 보기"
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-btn bg-brand px-4 text-[13px] font-extrabold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            />
            <MyPageConsultationButton
              quoteId={quote.id}
              sessionId={quote.sessionId}
              vehicleName={quote.vehicleName}
              trimName={quote.trimName}
              productType={quote.productType}
              contractMonths={quote.contractMonths}
              annualMileage={quote.annualMileage}
              className="min-h-11 !w-full"
            />
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-border-subtle pt-3 text-[12px] font-semibold text-text-muted">
            <Send size={14} strokeWidth={2} className="text-status-info" />
            {deliveryLabel}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function StatusPill({ quote, inverse = false }: { quote: MyPageQuote; inverse?: boolean }) {
  const className = inverse
    ? "bg-white/15 text-white ring-1 ring-inset ring-white/20"
    : statusToneClasses[quote.statusInfo.tone];

  return (
    <span className={`inline-flex shrink-0 items-center rounded-pill px-2.5 py-1 text-[11px] font-extrabold ${className}`}>
      {quote.pricingStatus === "CONSULTATION_REQUIRED" && quote.status === "NEW" ? "상담 필요" : quote.statusInfo.label}
    </span>
  );
}

function ProgressSteps({ currentIndex, status }: { currentIndex: number; status: MyPageQuote["status"] }) {
  if (status === "LOST") {
    return (
      <p className="mt-5 rounded-[14px] bg-surface-soft px-3.5 py-3 text-[13px] leading-5 text-text-body">
        이 견적의 진행은 종료되었어요. 차량과 조건을 바꿔 새로 비교해 보세요.
      </p>
    );
  }

  const steps = ["견적 접수", "상담 진행", "심사·계약", "계약 완료"];
  return (
    <ol className="mt-5 grid grid-cols-4 gap-1" aria-label="견적 진행 단계">
      {steps.map((step, index) => {
        const complete = index < currentIndex;
        const current = index === currentIndex;
        return (
          <li key={step} className="min-w-0">
            <span
              className={`mb-2 block h-1.5 rounded-full ${complete || current ? "bg-brand" : "bg-border-subtle"}`}
              aria-hidden="true"
            />
            <span className={`block break-keep text-[10.5px] font-bold leading-4 ${current ? "text-brand" : complete ? "text-text-body" : "text-text-muted"}`}>
              {step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-[14px] bg-surface-soft px-3 py-3">
      <p className="text-[11px] font-bold text-text-muted">{label}</p>
      <p className={`mt-1 break-keep tabular-nums text-[13px] font-extrabold ${emphasis ? "text-brand" : "text-text-strong"}`}>
        {value}
      </p>
    </div>
  );
}

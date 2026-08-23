import Link from "next/link";
import { Gift } from "lucide-react";

interface ReferralEntryCountdownBannerProps {
  /** 사후 입력 창구 잔여 일수. 0이면 오늘 마감 */
  readonly remainingDays: number;
}

/**
 * 추천인 코드 미입력 회원용 사후 입력 안내 배너.
 * 자격(가입 완료 14일 이내·미인정)은 서버가 판정해 그 경우에만 렌더한다.
 * 입력 surface는 쿠폰함의 ReferralCodeEntryCard 하나로 유지한다.
 */
export function ReferralEntryCountdownBanner({
  remainingDays,
}: ReferralEntryCountdownBannerProps) {
  return (
    <section
      className="mb-7 rounded-card border border-brand/25 bg-brand-soft p-4 md:mb-9 md:p-5"
      aria-labelledby="referral-countdown-heading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-surface text-brand">
          <Gift size={18} strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-extrabold text-brand">
            {remainingDays > 0
              ? `추천인 코드 입력까지 D-${remainingDays}`
              : "추천인 코드 입력이 오늘 마감돼요"}
          </p>
          <h2
            id="referral-countdown-heading"
            className="mt-1 text-[15px] font-extrabold text-text-strong"
          >
            지금 입력하면 계약 완료 시 모바일 상품권 10만원을 드려요
          </h2>
          <p className="mt-1 text-[12px] font-semibold leading-5 text-text-body">
            가입할 때 추천인 코드를 깜빡하셨나요? 지금 입력해도 추천한 분과 함께
            혜택을 받아요.
          </p>
          <Link
            href="/mypage/coupons"
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-btn bg-brand px-4 text-[13px] font-extrabold text-white transition-colors hover:bg-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
          >
            추천인 코드 입력하기
          </Link>
        </div>
      </div>
    </section>
  );
}

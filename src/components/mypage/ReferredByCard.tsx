import Link from "next/link";
import { HeartHandshake } from "lucide-react";
import { COUPON_STATUS_LABEL } from "@/constants/coupon";
import type { CouponStatusValue } from "@/lib/coupons/rules";

interface ReferredByCardCoupon {
  readonly status: CouponStatusValue;
  readonly title: string;
  readonly rewardLabel: string;
}

interface ReferredByCardProps {
  /** 마스킹된 추천인 이름 (예: 김*규) */
  readonly referrerName: string;
  /** REFERRAL_RECEIVED 쿠폰 스냅샷. 미발급이면 null */
  readonly coupon: ReferredByCardCoupon | null;
}

/** 추천으로 가입한 회원에게 추천인과 혜택 지급 상태를 보여주는 카드. */
export function ReferredByCard({ referrerName, coupon }: ReferredByCardProps) {
  return (
    <section
      className="mb-7 rounded-card border border-border-subtle bg-surface p-4 shadow-card md:mb-9 md:p-5"
      aria-labelledby="referred-by-heading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-brand-soft text-brand">
          <HeartHandshake size={18} strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <h2
            id="referred-by-heading"
            className="text-[15px] font-extrabold text-text-strong"
          >
            {referrerName}님의 추천으로 가입하셨어요
          </h2>
          {coupon ? (
            <p className="mt-1 text-[12px] font-semibold leading-5 text-text-body">
              {coupon.rewardLabel} ·{" "}
              <span className="text-brand">
                {COUPON_STATUS_LABEL[coupon.status]}
              </span>
              {coupon.status === "HELD" ? " — 계약 완료 시 지급돼요" : null}
            </p>
          ) : (
            <p className="mt-1 text-[12px] font-semibold leading-5 text-text-body">
              추천 혜택은 쿠폰함에서 확인하세요.
            </p>
          )}
          <Link
            href="/mypage/coupons"
            className="mt-2 inline-flex min-h-11 items-center text-[13px] font-extrabold text-brand transition-colors hover:text-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40"
          >
            쿠폰함에서 확인하기
          </Link>
        </div>
      </div>
    </section>
  );
}

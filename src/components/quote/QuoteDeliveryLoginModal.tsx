"use client";

import { useEffect } from "react";
import { Check, PhoneOff, X } from "lucide-react";

const DELIVERY_PROMISES = [
  "견적 절대 안 변해요 · 다른 데서 비교하고 오셔도 OK",
  "견적서만 보내드려요 · 불필요한 상담 안 해요",
] as const;

interface QuoteDeliveryLoginModalProps {
  open: boolean;
  onClose: () => void;
  onKakaoLogin: () => void;
}

/**
 * 견적서 수령 게이트 — 비회원이 "카카오톡으로 견적서 받기"를 눌렀을 때 노출.
 * 로그인을 요구하는 대신 "카톡으로 견적서를 보내드린다"는 약속으로 설득한다.
 * 초기비용 변경 게이트(LoginBenefitsModal)와 같은 캠페인 팔레트를 쓴다.
 */
export function QuoteDeliveryLoginModal({
  open,
  onClose,
  onKakaoLogin,
}: QuoteDeliveryLoginModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delivery-login-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <div className="relative w-full max-w-[400px] rounded-[24px] bg-white px-6 pb-6 pt-4 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full text-[#8A8F98] transition-colors hover:bg-[#F5F5F7] hover:text-[#111827]"
        >
          <X size={20} strokeWidth={2.4} />
        </button>

        <QuoteBubbleHero />

        <h2
          id="delivery-login-title"
          className="mt-1 text-center text-[26px] font-black leading-[1.25] tracking-[-0.03em] text-[#111827]"
        >
          카톡으로 견적서
          <br />
          <span className="relative inline-block">
            보내드릴게요
            <SparkleAccent />
          </span>
        </h2>

        <p className="mt-3 text-center text-[15px] font-extrabold text-[#374151]">
          카카오 로그인은 견적서를 보낼 때만 써요
        </p>

        <ul className="mt-4 space-y-2.5">
          {DELIVERY_PROMISES.map((promise) => (
            <li key={promise} className="flex items-start gap-2.5">
              <span
                aria-hidden
                className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#1FC26B]"
              >
                <Check size={11} strokeWidth={4} className="text-white" />
              </span>
              <span className="break-keep text-[14px] font-semibold leading-snug text-[#374151]">
                {promise}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-[16px] bg-[linear-gradient(180deg,#17B26A_0%,#0E9C58_100%)] px-5 py-3.5 shadow-[0_8px_20px_rgba(14,156,88,0.25)]">
          <div className="flex items-center justify-center gap-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-white/90 text-white"
            >
              <PhoneOff size={18} strokeWidth={2.4} />
            </span>
            <div className="text-left">
              <p className="text-[18px] font-extrabold leading-tight text-white">
                영업전화 절대 안 가요
              </p>
              <p className="mt-0.5 text-[12.5px] font-semibold text-[#CDF3DF]">
                안심하셔도 됩니다
              </p>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onKakaoLogin}
          className="mt-4 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#FEE500] px-4 text-[15.5px] font-extrabold text-[#191919] transition-colors hover:bg-[#F5DC00] active:scale-[0.98]"
        >
          <KakaoIcon />
          카카오로 3초 로그인하고 견적서 받기
        </button>

        <p className="mt-3.5 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#8A8F98]">
          로그인은 견적서 전송용이예요! 번호는 다른 용도로 안 써요!
          <span
            aria-hidden
            className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[4px] bg-[#1FC26B]"
          >
            <Check size={10} strokeWidth={4} className="text-white" />
          </span>
        </p>
      </div>
    </div>
  );
}

/** 히어로 — 오렌지 말풍선 속 견적서 문서. 따뜻한 글로우 + 반짝임 장식. */
function QuoteBubbleHero() {
  return (
    <div
      aria-hidden
      className="relative mx-auto flex h-[148px] w-[230px] items-center justify-center"
    >
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,#FFF1E1_0%,rgba(255,241,225,0)_75%)]" />
      <svg width="164" height="150" viewBox="0 0 164 150" fill="none" className="relative">
        {/* 말풍선 */}
        <path
          d="M82 8c34 0 58 20 58 47 0 26-24 45-58 45-5.6 0-11-.5-16-1.6L43 113c-2.9 1.7-6.2-1-5.2-4.2l4-14C32 87 26 73 26 55 26 28 48 8 82 8Z"
          fill="url(#delivery-bubble)"
        />
        {/* TALK 레터링 */}
        <text
          x="82"
          y="36"
          textAnchor="middle"
          fontSize="15"
          fontWeight="900"
          letterSpacing="2"
          fill="#fff"
          fontFamily="inherit"
        >
          TALK
        </text>
        {/* 견적서 문서 */}
        <g transform="rotate(-4 82 76)">
          <rect x="56" y="44" width="52" height="66" rx="6" fill="#fff" stroke="#EFE7DD" strokeWidth="1" />
          <text
            x="65"
            y="61"
            fontSize="11"
            fontWeight="800"
            fill="#111827"
            fontFamily="inherit"
          >
            견적서
          </text>
          <rect x="65" y="67" width="34" height="1.5" fill="#E4E8EE" />
          <rect x="65" y="74" width="26" height="3" rx="1.5" fill="#C9CFD8" />
          <rect x="65" y="81" width="34" height="3" rx="1.5" fill="#C9CFD8" />
          <rect x="65" y="88" width="20" height="3" rx="1.5" fill="#C9CFD8" />
          <text
            x="88"
            y="105"
            fontSize="16"
            fontWeight="900"
            fill="#F1500A"
            fontFamily="inherit"
          >
            ₩
          </text>
        </g>
        {/* 반짝임 */}
        <path d="M147 44l1.9 5.3 5.3 1.9-5.3 1.9-1.9 5.3-1.9-5.3-5.3-1.9 5.3-1.9 1.9-5.3Z" fill="#FF8A3D" />
        <path d="M18 66l1.5 4.3 4.3 1.5-4.3 1.5-1.5 4.3-1.5-4.3-4.3-1.5 4.3-1.5 1.5-4.3Z" fill="#FFB25E" />
        <path d="M146 104l1.5 4.2 4.2 1.5-4.2 1.5-1.5 4.2-1.5-4.2-4.2-1.5 4.2-1.5 1.5-4.2Z" fill="#FFCF9E" />
        {/* 왼쪽 위 강조 획 */}
        <path d="M32 22l6 6M27 33l8 3M43 14l3 8" stroke="#FF8A3D" strokeWidth="3" strokeLinecap="round" />
        <defs>
          <linearGradient
            id="delivery-bubble"
            x1="80"
            y1="8"
            x2="80"
            y2="110"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#FF8A3D" />
            <stop offset="1" stopColor="#F1500A" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** 헤드라인 오른쪽 반짝임 장식 */
function SparkleAccent() {
  return (
    <svg
      aria-hidden
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      className="absolute -right-8 top-1"
    >
      <path d="M16 2l1.8 5.2L23 9l-5.2 1.8L16 16l-1.8-5.2L9 9l5.2-1.8L16 2Z" fill="#FF7A00" />
      <path d="M5 15l1 2.8L8.8 19 6 20l-1 2.8L4 20l-2.8-1L4 17.8 5 15Z" fill="#FFB25E" />
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 3C5.58 3 2 5.79 2 9.21c0 2.18 1.5 4.09 3.74 5.16-.16.59-.59 2.13-.67 2.46-.1.41.15.4.32.29.13-.09 2.1-1.43 2.95-2.01.55.08 1.1.12 1.66.12 4.42 0 8-2.79 8-6.21S14.42 3 10 3z"
        fill="currentColor"
      />
    </svg>
  );
}

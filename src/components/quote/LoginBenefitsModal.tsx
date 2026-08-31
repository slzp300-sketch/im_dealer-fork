"use client";

import { useEffect } from "react";
import { Check, X } from "lucide-react";

const LOGIN_PERKS = [
  "초기비용 0원 견적 확인",
  "보증금·선납금 비율 자유 조절",
  "견적 저장하고 언제든 재확인",
] as const;

interface LoginBenefitsModalProps {
  open: boolean;
  onClose: () => void;
  onKakaoLogin: () => void;
  /** 로그인 없이 채널톡 상담으로 빠지는 이탈 경로 */
  onConsultation: () => void;
}

/**
 * 비회원 초기비용 변경 게이트 — 없음 토글·비율 변경 등 회원 전용 조건 조작 시 노출.
 * 막는 안내가 아니라 로그인하면 얻는 것(혜택 체크리스트)을 파는 전환 모달.
 * 이벤트 프로모션 모달과 같은 캠페인 팔레트(오렌지·그린·카카오)를 쓴다.
 */
export function LoginBenefitsModal({ open, onClose, onKakaoLogin, onConsultation }: LoginBenefitsModalProps) {
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
      aria-labelledby="login-benefits-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4"
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />

      <div className="relative w-full max-w-[380px] rounded-[24px] bg-white px-6 pb-6 pt-4 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full text-[#8A8F98] transition-colors hover:bg-[#F5F5F7] hover:text-[#111827]"
        >
          <X size={20} strokeWidth={2.4} />
        </button>

        <CarKeyHero />

        <h2
          id="login-benefits-title"
          className="mt-1 flex items-center justify-center gap-2 text-center text-[26px] font-black leading-tight tracking-[-0.03em] text-[#111827]"
        >
          <CarGlyph />
          지금 로그인하면
        </h2>

        <ul className="mt-4 space-y-2.5">
          {LOGIN_PERKS.map((perk) => (
            <li key={perk} className="flex items-start justify-center gap-2.5">
              <span
                aria-hidden
                className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FF7A00]"
              >
                <Check size={11} strokeWidth={4} className="text-white" />
              </span>
              <span className="break-keep text-[15px] font-semibold leading-snug text-[#374151]">
                {perk}
              </span>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={onConsultation}
          className="mt-5 flex min-h-[52px] w-full items-center justify-center rounded-[16px] border-2 border-[#582DFF] bg-[#F3EFFF] px-5 text-[15px] font-bold text-[#582DFF] transition-colors hover:bg-[#EBE4FF] active:scale-[0.98]"
        >
          로그인 없이 상담 시작하기
        </button>

        <button
          type="button"
          onClick={onKakaoLogin}
          className="mt-4 inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#FEE500] px-5 text-[16px] font-extrabold text-[#191919] transition-colors hover:bg-[#F5DC00] active:scale-[0.98]"
        >
          <KakaoIcon />
          카카오로 3초 로그인
        </button>

        <p className="mt-3.5 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#8A8F98]">
          로그인 후에도 견적 내용은 그대로 유지돼요
          <span
            aria-hidden
            className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] bg-[#1FC26B]"
          >
            <Check size={10} strokeWidth={4} className="text-white" />
          </span>
        </p>
      </div>
    </div>
  );
}

/** 히어로 — 자동차 키 플랫 일러스트. 따뜻한 글로우 + 반짝임 장식. */
function CarKeyHero() {
  return (
    <div aria-hidden className="relative mx-auto flex h-[148px] w-[220px] items-center justify-center">
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,#FFF1E1_0%,rgba(255,241,225,0)_75%)]" />
      <svg width="150" height="140" viewBox="0 0 150 140" fill="none" className="relative">
        <g transform="rotate(-14 75 70)">
          {/* 키링 */}
          <circle cx="75" cy="17" r="10" stroke="#B9C1CD" strokeWidth="6" />
          {/* 헤드 */}
          <rect x="43" y="23" width="64" height="56" rx="17" fill="url(#login-key-head)" />
          {/* 헤드 위 자동차 픽토그램 */}
          <path
            d="M64 52.5l3.6-5.6a3.4 3.4 0 0 1 2.9-1.6h9c1.2 0 2.3.6 2.9 1.6l3.6 5.6H64Z"
            fill="#fff"
          />
          <rect x="59" y="51.5" width="32" height="12.5" rx="4.5" fill="#fff" />
          <circle cx="67" cy="64.5" r="4" fill="#fff" />
          <circle cx="83" cy="64.5" r="4" fill="#fff" />
          {/* 섕크 */}
          <rect x="67" y="79" width="16" height="51" rx="7" fill="#C9D0DA" />
          <rect x="55" y="95" width="14" height="9" rx="3" fill="#C9D0DA" />
          <rect x="55" y="111" width="14" height="9" rx="3" fill="#C9D0DA" />
        </g>
        {/* 반짝임 */}
        <path d="M22 32l2.4 6.8 6.8 2.4-6.8 2.4L22 50.4l-2.4-6.8-6.8-2.4 6.8-2.4L22 32Z" fill="#FFB25E" />
        <path d="M128 22l1.7 4.8 4.8 1.7-4.8 1.7-1.7 4.8-1.7-4.8-4.8-1.7 4.8-1.7 1.7-4.8Z" fill="#FF8A3D" />
        <path d="M132 94l2 5.6 5.6 2-5.6 2-2 5.6-2-5.6-5.6-2 5.6-2 2-5.6Z" fill="#FFCF9E" />
        <path d="M16 98l1.4 4 4 1.4-4 1.4-1.4 4-1.4-4-4-1.4 4-1.4 1.4-4Z" fill="#FFD9B0" />
        <defs>
          <linearGradient
            id="login-key-head"
            x1="75"
            y1="23"
            x2="75"
            y2="79"
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

/** 헤드라인 옆 미니 자동차 글리프 */
function CarGlyph() {
  return (
    <svg width="27" height="18" viewBox="0 0 27 18" fill="none" aria-hidden>
      <path
        d="M5.5 8.5l2.7-4.3a2.6 2.6 0 0 1 2.2-1.2h6.2c.9 0 1.7.45 2.2 1.2l2.7 4.3H5.5Z"
        fill="#F1500A"
      />
      <rect x="1" y="8" width="25" height="7.5" rx="3.2" fill="#F1500A" />
      <rect x="10.6" y="4.6" width="5.8" height="3.4" rx="1.2" fill="#FFE3D2" />
      <circle cx="7.5" cy="15.2" r="2.6" fill="#3B2417" />
      <circle cx="19.5" cy="15.2" r="2.6" fill="#3B2417" />
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

"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Flame, PhoneOff, X } from "lucide-react";
import { openChannelTalk, trackEventConsultation } from "@/lib/channel-talk";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";
import type { EventCar } from "./VehicleCard";

// 클릭 핸들러에서 동기적으로 창을 열어야 팝업 차단을 피한다.
function openConsult() {
  const url = kakaoChannelChatUrl();
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  openChannelTalk();
}

const PROMO_POINTS = [
  "초기비용 0원 견적",
  "견적 절대 안 변해요 · 다른 데서 비교하고 오셔도 OK",
  "차량 1주일 이내 인도 가능",
  "보증금·선납금 조건 변경하면 더 싸져요",
] as const;

/**
 * 이벤트 페이지 상담 진입 공용 프로모션 모달.
 * 차량 카드·하단 상담 바·상담 유도 카드 어디서 열려도 동일한 혜택 소구 후
 * 확인 시 카카오톡 채널 대화창을 연다. car 가 있으면 상담 추적에 차량 정보를 싣는다.
 */
export function EventPromoModal({
  open,
  onClose,
  car,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly car?: EventCar | null;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = original;
    };
  }, [open, onClose]);

  const handleConfirm = () => {
    // 카카오 링크는 데이터를 실을 수 없으므로, 열기 직전에 채널톡 이벤트로 차량 정보를 남긴다.
    trackEventConsultation({
      source: "/event",
      ...(car
        ? {
            vehicleName: `${car.brand} ${car.model}`,
            trimName: car.trim,
            monthlyPrice: `월 ${car.nowMonthly}만원`,
            discount: car.discount,
          }
        : {}),
    });
    openConsult();
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/55"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 14 }}
            transition={{ duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="event-promo-title"
            className="relative w-full max-w-[420px] rounded-[24px] bg-white shadow-2xl"
          >
            <button
              type="button"
              aria-label="닫기"
              onClick={onClose}
              className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full text-[#8A8F98] transition-colors hover:bg-[#F5F5F7] hover:text-[#111827]"
            >
              <X size={20} strokeWidth={2.4} />
            </button>

            <div className="px-6 pb-6 pt-7 md:px-8">
            <PromoTicket />

            <h2
              id="event-promo-title"
              className="mt-5 text-center text-[28px] font-black leading-tight tracking-[-0.03em] text-[#111827] md:text-[31px]"
            >
              <span className="relative inline-block">
                지금이 가장 싼 순간!
                <SparkleAccent />
              </span>
            </h2>

            <ul className="mt-5 space-y-3">
              {PROMO_POINTS.map((point, i) => (
                <motion.li
                  key={point}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: 0.12 + i * 0.06 }}
                  className="flex items-start gap-2.5"
                >
                  <span
                    aria-hidden
                    className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#FF7A00]"
                  >
                    <Check size={11} strokeWidth={4} className="text-white" />
                  </span>
                  <span className="break-keep text-[15px] font-semibold leading-snug text-[#374151]">
                    {point}
                  </span>
                </motion.li>
              ))}
            </ul>

            <div className="mt-5 rounded-[16px] bg-[linear-gradient(180deg,#17B26A_0%,#0E9C58_100%)] px-5 py-4 shadow-[0_8px_20px_rgba(14,156,88,0.25)]">
              <div className="flex items-center justify-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[2.5px] border-white/90 text-white"
                >
                  <PhoneOff size={18} strokeWidth={2.4} />
                </span>
                <div className="text-left">
                  <p className="text-[19px] font-extrabold leading-tight text-white">
                    영업전화 절대 안 해요
                  </p>
                  <p className="mt-0.5 text-[13px] font-semibold text-[#CDF3DF]">
                    안심하고 상담 받아 보세요
                  </p>
                </div>
              </div>
            </div>

            {car ? (
              <p className="mt-4 text-center text-[13px] font-semibold text-[#8A8F98]">
                상담 차량 ·{" "}
                <span className="font-extrabold text-[#111827]">
                  {car.brand} {car.model}
                </span>{" "}
                월 {car.nowMonthly}만원
              </p>
            ) : null}

            <button
              type="button"
              onClick={handleConfirm}
              className={`${car ? "mt-2.5" : "mt-4"} inline-flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[16px] bg-[#FEE500] px-5 text-[16px] font-extrabold text-[#191919] transition-colors hover:bg-[#F5DC00] active:scale-[0.98]`}
            >
              <KakaoBubbleIcon />
              카카오톡으로 상담하기
            </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}

/**
 * 모달 상단의 티켓형 프로모션 배지.
 * 흰 카드 위에 여백을 두고 떠 있는 실제 티켓 모양 — 왼쪽 불꽃 스텁,
 * 세로 절취선, 절취선 위아래 노치(흰 원이 티켓 밖으로 반쯤 걸쳐 잘린 형태).
 */
function PromoTicket() {
  return (
    <div
      aria-hidden
      className="mx-auto w-fit [filter:drop-shadow(0_8px_16px_rgba(226,74,10,0.28))]"
    >
      <div className="relative flex items-stretch overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,#FF8A3D_0%,#F1500A_100%)]">
        {/* 스텁 */}
        <div className="flex w-[54px] items-center justify-center">
          <Flame size={24} strokeWidth={0} fill="#FFE14D" />
        </div>
        {/* 절취선 */}
        <div className="border-l-2 border-dashed border-white/50" />
        {/* 본문 */}
        <div className="px-5 py-3 text-left">
          <p className="text-[21px] font-black leading-tight text-white">특가 프로모션</p>
          <p className="mt-0.5 text-[13px] font-bold leading-tight text-[#FFD9C2]">
            재고 소진 시까지
          </p>
        </div>
        {/* 절취선 위아래 노치 */}
        <span className="absolute -top-2 left-[54px] h-4 w-4 -translate-x-1/2 rounded-full bg-white" />
        <span className="absolute -bottom-2 left-[54px] h-4 w-4 -translate-x-1/2 rounded-full bg-white" />
      </div>
    </div>
  );
}

/** 헤드라인 오른쪽 위 반짝임 장식 */
function SparkleAccent() {
  return (
    <svg
      aria-hidden
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      className="absolute -right-7 -top-4"
    >
      <path
        d="M16 2l1.8 5.2L23 9l-5.2 1.8L16 16l-1.8-5.2L9 9l5.2-1.8L16 2Z"
        fill="#FF7A00"
      />
      <path d="M5 15l1 2.8L8.8 19 6 20l-1 2.8L4 20l-2.8-1L4 17.8 5 15Z" fill="#FFB25E" />
    </svg>
  );
}

function KakaoBubbleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 2.5c-4.14 0-7.5 2.56-7.5 5.72 0 2.02 1.42 3.8 3.55 4.8l-.58 2.12c-.1.36.12.5.42.32l2.62-1.62c.49.07.99.1 1.49.1 4.14 0 7.5-2.56 7.5-5.72S14.14 2.5 10 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { openChannelTalk, trackEventConsultation } from "@/lib/channel-talk";
import { kakaoChannelChatUrl } from "@/lib/kakao/channel-add";

export type EventCar = {
  id: string;
  brand: string;
  model: string;
  trim: string;
  option: string;
  stock: string;
  image: string;
  wasMonthly: string;
  nowMonthly: string;
  discount: string;
  listPrice: string;
  featured?: boolean;
};

// 클릭 핸들러에서 동기적으로 창을 열어야 팝업 차단을 피한다 (EventConsultBar와 동일 동작).
function openConsult() {
  const url = kakaoChannelChatUrl();
  if (url) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  openChannelTalk();
}

function StockBadge({ stock }: { stock: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#FFF0F0] px-3 py-1.5 text-[14px] font-extrabold leading-none text-[#FF5A2E]">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FF5A2E]" aria-hidden />
      {stock} 남음
    </span>
  );
}

function ConsultConfirmModal({
  car,
  open,
  onClose,
}: {
  car: EventCar;
  open: boolean;
  onClose: () => void;
}) {
  const handleConfirm = () => {
    // 카카오 링크는 데이터를 실을 수 없으므로, 열기 직전에 채널톡 이벤트로 차량 정보를 남긴다.
    // 채널톡↔카카오 연동으로 상담사가 데스크에서 어떤 차량 문의인지 확인할 수 있다.
    trackEventConsultation({
      source: "/event",
      vehicleName: `${car.brand} ${car.model}`,
      trimName: car.trim,
      monthlyPrice: `월 ${car.nowMonthly}만원`,
      discount: car.discount,
    });
    openConsult();
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/50"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="relative w-full max-w-[400px] rounded-[20px] bg-white p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="consult-modal-title"
          >
            <p id="consult-modal-title" className="text-[18px] font-extrabold text-[#111827]">
              {car.brand} {car.model}
            </p>
            <p className="mt-2 text-[15px] leading-relaxed text-[#555555]">
              카카오톡 상담으로 이어서 진행하시겠어요?
              <br />
              상담은 무료이며, 부담 없이 문의하셔도 됩니다.
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-[14px] bg-[#F5F5F7] py-3.5 text-[15px] font-bold text-[#555555] transition-colors hover:bg-[#E8E9ED] active:scale-[0.98]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                className="flex-1 rounded-[14px] bg-[#FEE500] py-3.5 text-[15px] font-bold text-[#191919] transition-colors hover:bg-[#F5DC00] active:scale-[0.98]"
              >
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

export function VehicleCard({ car, index = 0 }: { car: EventCar; index?: number }) {
  const featured = Boolean(car.featured);
  const [modalOpen, setModalOpen] = useState(false);

  const subText = featured ? "text-[#9CA3AF]" : "text-[#8A8F98]";

  return (
    <>
      <motion.button
        type="button"
        onClick={() => setModalOpen(true)}
        aria-label={`${car.brand} ${car.model} ${car.trim} 상담 문의`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: (index % 3) * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={[
        "group flex h-full w-full cursor-pointer flex-col rounded-[20px] px-4 pb-4 pt-3.5 text-left md:px-6 md:pb-6 md:pt-5",
        "transition-[transform,box-shadow,background-color] duration-200 ease-out",
        "hover:-translate-y-1 active:translate-y-0 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0066FF] focus-visible:ring-offset-2",
        featured
          ? "bg-[#2B2D33] shadow-[0_6px_18px_rgba(17,24,39,0.10)] hover:bg-[#33363D] hover:shadow-[0_16px_32px_rgba(17,24,39,0.22)]"
          : "bg-white shadow-[0_6px_18px_rgba(17,24,39,0.06)] hover:shadow-[0_16px_32px_rgba(17,24,39,0.13)]",
      ].join(" ")}
    >
      {featured ? (
        <div className="mb-2 flex items-center justify-between">
          <span className="rounded-[6px] bg-[#FFE14D] px-2 py-1 text-[12px] font-extrabold leading-none text-black">
            주목 차량
          </span>
          <StockBadge stock={car.stock} />
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[14px] leading-none ${featured ? "text-[#C5C8CE]" : "text-[#8A8F98]"}`}>
            {car.brand}
          </p>
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
            <span className={`text-[24px] font-extrabold leading-tight ${featured ? "text-white" : "text-black"}`}>
              {car.model}
            </span>
            {car.trim ? (
              <span className={`text-[15px] leading-tight ${featured ? "text-[#B0B4BC]" : "text-[#555555]"}`}>
                {car.trim}
              </span>
            ) : null}
          </p>
          {car.option ? (
            <p className={`mt-1.5 text-[14px] leading-[1.35] ${subText}`}>
              {car.option}
            </p>
          ) : null}
        </div>
        {featured ? null : <StockBadge stock={car.stock} />}
      </div>

      <div className="mt-2 flex w-full flex-1 items-center justify-center overflow-hidden py-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={car.image}
          alt={`${car.brand} ${car.model}`}
          className="mx-auto h-auto w-full max-w-[560px] object-contain transition-transform duration-300 ease-out group-hover:-translate-y-1 group-hover:scale-[1.05]"
          decoding="async"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>

      <div className="mt-auto pt-3 text-center">
        <div className="flex items-end justify-center gap-1.5">
          <span className={`flex items-baseline gap-px ${subText}`}>
            <span className="text-[13px]">월</span>
            <span className="text-[20px] font-semibold leading-none line-through opacity-75">{car.wasMonthly}</span>
            <span className="text-[13px]">만원</span>
          </span>
          <span className={`mb-1 text-[16px] ${subText}`}>&gt;</span>
          <span className="flex items-baseline gap-px text-[#1A73E8]">
            <span className="text-[15px] font-bold">월</span>
            <span className="text-[40px] font-extrabold leading-none">{car.nowMonthly}</span>
            <span className="text-[15px] font-bold">만원</span>
          </span>
        </div>
        <p className={`mt-1 text-[13px] ${subText}`}>
          차량가 {car.listPrice}
        </p>
        <span className="mt-2 inline-flex min-w-[170px] justify-center rounded-full bg-[#FFF0F0] px-6 py-2 text-[20px] font-extrabold text-[#FF5A2E]">
          {car.discount} 할인
        </span>
        <p className={`mt-2 text-[12px] ${subText}`}>
          60개월 · 초기비용 0원 · 연 2만km 기준
        </p>
      </div>
    </motion.button>

      <ConsultConfirmModal car={car} open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

/** 그리드 마지막 셀을 채우는 상담 유도 카드 */
export function EventConsultCard({ index = 0 }: { index?: number }) {
  const handleClick = () => {
    trackEventConsultation({ source: "/event" });
    openConsult();
  };

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      aria-label="찾는 차량이 없을 때 카카오톡 상담하기"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.4, delay: (index % 3) * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
      className={[
        "group flex h-full min-h-[200px] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-[20px] px-6 py-8 text-center",
        "ring-2 ring-dashed ring-[#C9CED6] transition-all duration-200 ease-out",
        "hover:-translate-y-1 hover:bg-white hover:ring-[#0066FF]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0066FF] focus-visible:ring-offset-2",
      ].join(" ")}
    >
      <p className="text-[18px] font-extrabold leading-snug text-[#111827] md:text-[20px]">
        찾는 차량이 없으신가요?
      </p>
      <p className="text-[14px] leading-relaxed text-[#8A8F98]">
        다른 차종도 특판가로 준비해 드릴게요.
        <br />
        재고와 견적을 바로 안내해 드립니다.
      </p>
      <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-[#0066FF] px-5 py-2.5 text-[14px] font-bold text-white transition-colors group-hover:bg-[#0052CC]">
        카카오톡으로 상담하기
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </motion.button>
  );
}

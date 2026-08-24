import type { Metadata } from "next";
import { VehicleCard, type EventCar } from "./VehicleCard";

export const metadata: Metadata = {
  title: "장기렌트 오픈 한정 특별판매 프로모션",
};

const CARS: EventCar[] = [
  {
    id: "filant",
    brand: "르노코리아",
    model: "필랑트",
    trim: "하이브리드 E-tech iconic",
    option: "옵션: 시그니처 패키지",
    stock: "3대",
    image: "/images/event/filant.png",
    wasMonthly: "73",
    nowMonthly: "66",
    discount: "420만원",
    listPrice: "50,850,000원",
    featured: true,
  },
  {
    id: "sorento",
    brand: "기아",
    model: "쏘렌토",
    trim: "1.6 하이브리드 노블레스 5인승",
    option: "옵션: 컴포트, 드라이브 와이즈",
    stock: "3대",
    image: "/images/event/sorento-hev.png",
    wasMonthly: "63",
    nowMonthly: "58",
    discount: "290만원",
    listPrice: "47,440,000원",
  },
  {
    id: "palisade",
    brand: "현대",
    model: "팰리세이드",
    trim: "하이브리드 2.5 프레스티지 7인승",
    option: "옵션: 컴포트 플러스(7인승), 빌트인캠2+, 원격 스마트 주차보조",
    stock: "9대",
    image: "/images/event/palisade.png",
    wasMonthly: "83",
    nowMonthly: "79",
    discount: "280만원",
    listPrice: "60,890,000원",
  },
  {
    id: "grandeur-hev",
    brand: "현대",
    model: "그랜저",
    trim: "하이브리드 1.6 익스클루시브",
    option: "옵션: 프리미엄 패키지, 빌트인캠",
    stock: "3대",
    image: "/images/event/grandeur-hev.png",
    wasMonthly: "80",
    nowMonthly: "74",
    discount: "340만원",
    listPrice: "59,370,000원",
  },
  {
    id: "grandeur",
    brand: "현대",
    model: "그랜저",
    trim: "가솔린 익스클루시브",
    option: "옵션: 프리미엄 패키지",
    stock: "9대",
    image: "/images/event/grandeur.png",
    wasMonthly: "72",
    nowMonthly: "66",
    discount: "320만원",
    listPrice: "51,350,000원",
  },
  {
    id: "g80",
    brand: "제네시스",
    model: "G80",
    trim: "2.5 AWD",
    option: "옵션: 럭셔리 패키지",
    stock: "1대",
    image: "/images/event/g80.png",
    wasMonthly: "106",
    nowMonthly: "101",
    discount: "300만원",
    listPrice: "73,600,000원",
  },
  {
    id: "pv5",
    brand: "기아",
    model: "PV5",
    trim: "2WD A/T 5인승 플러스",
    option: "옵션: 플러스 패키지",
    stock: "3대",
    image: "/images/event/pv5.png",
    wasMonthly: "73",
    nowMonthly: "68",
    discount: "350만원",
    listPrice: "52,920,000원",
  },
];

export default function EventPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans">
      <div className="mx-auto w-full max-w-[390px]">
        <header className="bg-[linear-gradient(180deg,#0A1633_0%,#050910_100%)] px-6 pb-6 pt-12 text-center">
          <p className="text-[12px] font-semibold text-[#7EC8FF]">
            아임딜러AI OPEN EVENT
          </p>
          <h1 className="mt-2.5 text-[24px] font-extrabold leading-[1.25] text-white">
            장기렌트 오픈 한정
            <br />
            특별판매 프로모션
          </h1>
          <span className="mt-4 inline-flex rounded-full bg-[#0066FF] px-4 py-2 text-[13px] font-bold leading-none text-white">
            재고 소진 시 조기 종료
          </span>
          <div className="mt-5 flex justify-center" aria-hidden>
            <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
              <path d="M1 1.5L6 6.5L11 1.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
        </header>

        <main className="px-4 pb-8 pt-5">
          <h2 className="text-center text-[17px] font-extrabold text-[#0066FF]">
            특판 차량 라인업
          </h2>
          <div className="mt-[10px] flex justify-center gap-1.5">
            <span className="rounded-full bg-[#E8E9ED] px-3 py-[6px] text-[12px] font-semibold text-[#6B7280]">
              60개월
            </span>
            <span className="rounded-full bg-[#FF7A00] px-3 py-[6px] text-[12px] font-bold text-white">
              초기비용 0원
            </span>
            <span className="rounded-full bg-[#E8E9ED] px-3 py-[6px] text-[12px] font-semibold text-[#6B7280]">
              연 2만km
            </span>
          </div>

          <div className="mt-3 flex flex-col gap-3">
            {CARS.map((car) => (
              <VehicleCard key={car.id} car={car} />
            ))}
          </div>
        </main>

        <section className="bg-[#0066FF] px-5 pb-7 pt-7">
          <h2 className="text-[18px] font-extrabold text-white">
            아임딜러 특별 오픈 이벤트
          </h2>
          <p className="mt-1 text-[13px] font-medium text-white">
            특단가에 30만원 혜택까지?!
          </p>
          <div className="relative mt-4 overflow-hidden rounded-[16px] bg-white px-4 pb-5 pt-5">
            <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF]" />
            <span className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF]" />
            <p className="text-center text-[11px] font-extrabold tracking-[0.16em] text-[#0066FF]">
              SPECIAL COUPON
            </p>
            <p className="mt-1.5 text-center text-[14px] font-bold text-[#111827]">
              계약 혜택
            </p>
            <p className="mt-0.5 text-center text-[28px] font-extrabold leading-none text-[#0066FF]">
              +30만원
            </p>
          </div>
          <p className="mt-2.5 text-center text-[12px] text-white">
            이벤트 기간 내 계약 완료 고객 대상
          </p>
        </section>
      </div>
    </div>
  );
}

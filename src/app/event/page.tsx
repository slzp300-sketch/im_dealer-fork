import type { Metadata } from "next";
import Image from "next/image";
import { Header } from "@/components/layout/Header";
import { EventConsultBar } from "./EventConsultBar";
import { EventConsultCard, VehicleCard, type EventCar } from "./VehicleCard";

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
    image: "/images/event/filant.webp",
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
    image: "/images/event/sorento-hev.webp",
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
    image: "/images/event/palisade.webp",
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
    image: "/images/event/grandeur-hev.webp",
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
    image: "/images/event/grandeur.webp",
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
    image: "/images/event/g80.webp",
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
    image: "/images/event/pv5.webp",
    wasMonthly: "73",
    nowMonthly: "68",
    discount: "350만원",
    listPrice: "52,920,000원",
  },
];

export default function EventPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans">
      <Header />
      <div className="w-full">
        <header className="bg-[linear-gradient(180deg,#0A1633_0%,#050910_100%)] px-6 pb-9 pt-14 text-center md:pb-14 md:pt-20">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:text-left">
            <div className="min-w-0">
              <p className="text-[14px] font-bold tracking-[0.08em] text-[#7EC8FF] md:text-[16px]">
                아임딜러AI
              </p>
              <p className="mt-1.5 bg-[linear-gradient(90deg,#7EC8FF_0%,#3D8BFF_50%,#7EC8FF_100%)] bg-clip-text text-[44px] font-black leading-none tracking-tight text-transparent md:text-[64px] lg:text-[72px]">
                OPEN EVENT
              </p>
              <h1 className="mt-4 break-keep text-[28px] font-extrabold leading-[1.3] tracking-[-0.02em] text-white md:mt-5 md:text-[40px] md:leading-[1.2]">
                장기렌트 오픈 한정
                <br />
                특별판매 프로모션
              </h1>
              <div className="mt-5 md:mt-6">
                <span className="inline-flex rounded-full bg-[#0066FF] px-5 py-2.5 text-[15px] font-bold leading-none text-white md:text-[16px]">
                  재고 소진 시 조기 종료
                </span>
              </div>
            </div>
            <div className="relative hidden lg:block" aria-hidden>
              <div className="absolute inset-0 bg-[radial-gradient(80%_90%_at_50%_60%,rgba(37,99,235,0.28)_0%,transparent_70%)]" />
              <Image
                src="/images/event/open-event-cars-keyed.png"
                alt=""
                width={750}
                height={375}
                className="relative w-full select-none"
                priority
              />
            </div>
          </div>
          <div className="mt-6 flex justify-center lg:hidden" aria-hidden>
            <svg width="14" height="9" viewBox="0 0 12 8" fill="none">
              <path d="M1 1.5L6 6.5L11 1.5" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </div>
        </header>

        <main className="px-4 pb-8 pt-5 md:pb-16 md:pt-12">
          <div className="mx-auto w-full max-w-[1120px]">
            <div className="text-center md:text-left">
              <p className="text-[12.5px] font-bold text-[#0066FF] md:text-[13.5px]">
                오픈 한정 특가
              </p>
              <h2 className="mt-1.5 text-[17px] font-extrabold tracking-[-0.02em] text-text-strong md:text-[32px]">
                특판 차량 라인업
              </h2>
              <p className="mt-2 hidden break-keep text-[15px] text-text-body md:block">
                전 차량 초기비용 0원. 재고가 소진되면 해당 차량은 조기 마감됩니다.
              </p>
            </div>
            <div className="mt-[10px] flex justify-center gap-1.5 md:mt-4 md:justify-start md:gap-2">
              <span className="rounded-full bg-[#E8E9ED] px-3 py-[6px] text-[12px] font-semibold text-[#6B7280] md:px-4 md:py-2 md:text-[13px]">
                60개월
              </span>
              <span className="rounded-full bg-[#FF7A00] px-3 py-[6px] text-[12px] font-bold text-white md:px-4 md:py-2 md:text-[13px]">
                초기비용 0원
              </span>
              <span className="rounded-full bg-[#E8E9ED] px-3 py-[6px] text-[12px] font-semibold text-[#6B7280] md:px-4 md:py-2 md:text-[13px]">
                연 2만km
              </span>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:mt-6 md:grid-cols-2 md:gap-5 lg:grid-cols-3">
              {CARS.map((car, i) => (
                <VehicleCard key={car.id} car={car} index={i} />
              ))}
              <EventConsultCard index={CARS.length} />
            </div>
          </div>
        </main>

        <section className="bg-[#0066FF] px-5 pb-[calc(116px+env(safe-area-inset-bottom,0px))] pt-7 md:pb-[calc(160px+env(safe-area-inset-bottom,0px))] md:pt-20">
          <div className="mx-auto grid w-full max-w-[1120px] items-center gap-6 lg:grid-cols-[1fr_auto] lg:gap-16">
            <div className="lg:text-left">
              <p className="text-[12.5px] font-bold text-white/70 md:text-[14px]">
                계약 혜택
              </p>
              <h2 className="text-[18px] font-extrabold text-white md:text-[36px] md:leading-[1.25]">
                아임딜러 특별 오픈 이벤트
              </h2>
              <p className="mt-1 text-[13px] font-medium text-white md:mt-3 md:text-[18px]">
                특단가에 30만원 혜택까지?!
              </p>
              <p className="mt-2.5 hidden text-[13px] text-white/80 md:block lg:mt-5 md:text-[14px]">
                이벤트 기간 내 계약 완료 고객 대상
              </p>
            </div>
            <div className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-[16px] bg-white px-4 pb-5 pt-5 md:rounded-[20px] md:px-10 md:pb-9 md:pt-9 lg:mx-0 lg:w-[440px] lg:max-w-none">
              <span className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF] md:h-7 md:w-7" />
              <span className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF] md:h-7 md:w-7" />
              <p className="text-center text-[11px] font-extrabold tracking-[0.16em] text-[#0066FF] md:text-[13px]">
                SPECIAL COUPON
              </p>
              <p className="mt-1.5 text-center text-[14px] font-bold text-[#111827] md:mt-2 md:text-[16px]">
                계약 혜택
              </p>
              <p className="mt-0.5 text-center text-[28px] font-extrabold leading-none text-[#0066FF] md:mt-1 md:text-[44px]">
                +30만원
              </p>
            </div>
            <p className="text-center text-[12px] text-white md:hidden">
              이벤트 기간 내 계약 완료 고객 대상
            </p>
          </div>
        </section>
      </div>
      <EventConsultBar />
    </div>
  );
}

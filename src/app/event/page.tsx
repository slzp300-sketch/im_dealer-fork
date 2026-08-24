import type { Metadata } from "next";
import { VehicleCard, type EventCar } from "./VehicleCard";

export const metadata: Metadata = {
  title: "장기렌트 오픈 한정 특별판매 프로모션",
};

const CARS: EventCar[] = [
  {
    id: "filant",
    brand: "르노코리아",
    model: "빌랑트 테크노 E-Tech Hybrid",
    option: "옵션: 시그니처 패키지",
    stock: "3대",
    image: "/images/event/filant.png",
    wasMonthly: "72",
    nowMonthly: "65",
    discount: "420만원",
    listPrice: "54,400,000원",
    featured: true,
  },
  {
    id: "sorento-hev",
    brand: "기아",
    model: "쏘렌토",
    option: "1.6 하이브리드 노블레스 5인승",
    stock: "3대",
    image: "/images/event/sorento-hev.png",
    wasMonthly: "63",
    nowMonthly: "58",
    discount: "290만원",
    listPrice: "48,900,000원",
  },
  {
    id: "palisade",
    brand: "현대",
    model: "팰리세이드",
    option: "2.2 디젤 4WD 캘리그래피",
    stock: "2대",
    image: "/images/event/palisade.png",
    wasMonthly: "83",
    nowMonthly: "78",
    discount: "280만원",
    listPrice: "61,200,000원",
  },
  {
    id: "grandeur-hev",
    brand: "현대",
    model: "그랜저 하이브리드",
    option: "1.6 가솔린 프리미엄",
    stock: "2대",
    image: "/images/event/grandeur-hev.png",
    wasMonthly: "79",
    nowMonthly: "74",
    discount: "340만원",
    listPrice: "52,800,000원",
  },
  {
    id: "grandeur",
    brand: "현대",
    model: "그랜저",
    option: "가솔린 2.5 프리미엄",
    stock: "9대",
    image: "/images/event/grandeur.png",
    wasMonthly: "71",
    nowMonthly: "66",
    discount: "320만원",
    listPrice: "46,700,000원",
  },
  {
    id: "g80",
    brand: "제네시스",
    model: "G80",
    option: "2.5 AWD",
    stock: "1대",
    image: "/images/event/g80.png",
    wasMonthly: "106",
    nowMonthly: "100",
    discount: "420만원",
    listPrice: "68,500,000원",
  },
  {
    id: "pv5",
    brand: "기아",
    model: "PV5",
    option: "2WD A/T 800+ 플러스",
    stock: "3대",
    image: "/images/event/pv5.png",
    wasMonthly: "73",
    nowMonthly: "67",
    discount: "350만원",
    listPrice: "49,600,000원",
  },
];

export default function EventPage() {
  return (
    <div className="min-h-screen bg-[#F5F6F7] font-sans">
      <div className="mx-auto w-full max-w-[430px]">
        <header className="bg-[#001A41] px-6 pb-9 pt-12 text-center">
          <p className="text-[12px] font-semibold tracking-[0.08em] text-[#39C4FF]">
            아임딜러AI OPEN EVENT
          </p>
          <h1 className="mt-3 text-[26px] font-extrabold leading-[1.3] text-white">
            장기렌트 오픈 한정
            <br />
            특별판매 프로모션
          </h1>
          <span className="mt-5 inline-flex rounded-[8px] bg-[#0066FF] px-3.5 py-1.5 text-[13px] font-bold text-white">
            재고 소진 시 조기 종료
          </span>
          <div className="mt-7 flex justify-center" aria-hidden>
            <span className="block h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-white" />
          </div>
        </header>

        <main className="px-5 pb-10 pt-8">
          <h2 className="text-[22px] font-extrabold leading-tight text-[#0066FF]">
            특판 차량 라인업
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-[#FFE8D6] px-3 py-1 text-[12px] font-bold text-[#FF6B00]">
              60개월
            </span>
            <span className="rounded-full bg-[#FF6B00] px-3 py-1 text-[12px] font-bold text-white">
              초기비용 0원
            </span>
            <span className="rounded-full bg-[#FFE8D6] px-3 py-1 text-[12px] font-bold text-[#FF6B00]">
              연 2만km
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-4">
            {CARS.map((car) => (
              <VehicleCard key={car.id} car={car} />
            ))}
          </div>
        </main>

        <section className="bg-[#0066FF] px-5 py-10">
          <h2 className="text-[22px] font-extrabold leading-tight text-white">
            아임딜러 특별 오픈 이벤트
          </h2>
          <p className="mt-2 text-[15px] font-medium text-white">
            특가에 30만원 혜택까지?!
          </p>
          <div className="relative mt-6 overflow-hidden rounded-[16px] bg-white px-5 pb-6 pt-7">
            <div
              className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF]"
              aria-hidden
            />
            <div
              className="pointer-events-none absolute right-0 top-1/2 h-5 w-5 translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0066FF]"
              aria-hidden
            />
            <p className="text-center text-[11px] font-extrabold tracking-[0.16em] text-[#0066FF]">
              SPECIAL COUPON
            </p>
            <p className="mt-2 text-center text-[22px] font-extrabold text-[#0066FF]">
              계약 혜택 +30만원
            </p>
            <p className="mt-2 text-center text-[12px] text-[#6B7280]">
              이벤트 기간 내 계약 완료 고객 대상
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

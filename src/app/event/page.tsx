import type { Metadata } from "next";
import { Suspense } from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "장기렌트 오픈 한정 특별판매 프로모션",
};

/**
 * 이벤트 랜딩 페이지.
 *
 * - 모바일(~1024px 미만): 648px 폭 시안을 비율 그대로 재현한다. 치수는 시안 px 기준이며
 *   cqw(컨테이너 너비 1%) 단위로 변환한 값이다. 변환식: 시안px / 6.48 = cqw.
 *   각 섹션 내부 컨테이너가 max-w-[648px]로 캡되므로 태블릿에서도 시안 비율이 유지된다.
 * - 데스크톱(lg+): 서비스 헤더/푸터를 넣고 전체 폭 레이아웃으로 확장한다.
 *   히어로 우측에는 홈 배너와 같은 open-event-cars 아트워크를 재사용해 연속성을 맞춘다.
 * - 차량 데이터는 하드코딩(DB 연동 전)이며, 시안의 플레이스홀더("00%", "#특징1")도 그대로 둔다.
 */

interface EventCar {
  brand: string;
  name: string;
  stock: string;
  tags: string[] | null;
  image: { src: string; width: number; height: number };
  normalPrice: string;
  specialPrice: string;
  normalMonthly: string;
  specialMonthly: string;
  dark?: boolean;
}

const CARS: EventCar[] = [
  {
    brand: "르노코리아",
    name: "필랑트",
    stock: "1대",
    tags: null,
    image: { src: "/images/event/filant.png", width: 398, height: 197 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
    dark: true,
  },
  {
    brand: "제네시스",
    name: "G80",
    stock: "1대",
    tags: ["#가솔린", "#프리미엄", "#세단"],
    image: { src: "/images/event/g80.png", width: 372, height: 170 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
  {
    brand: "현대",
    name: "더 뉴 그랜저",
    stock: "1대",
    tags: ["#가솔린", "#인기", "#세단"],
    image: { src: "/images/event/grandeur.png", width: 385, height: 165 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
  {
    brand: "현대",
    name: "디올 뉴 팰리세이드",
    stock: "1대",
    tags: ["#가솔린", "#인기", "#SUV"],
    image: { src: "/images/event/palisade.png", width: 373, height: 195 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
  {
    brand: "현대",
    name: "더 뉴 그랜저 HEV",
    stock: "1대",
    tags: ["#하이브리드", "#프리미엄", "#세단"],
    image: { src: "/images/event/grandeur-hev.png", width: 372, height: 160 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
  {
    brand: "기아",
    name: "더 뉴 쏘렌토 HEV",
    stock: "1대",
    tags: ["#특징1", "#특징1", "#특징1"],
    image: { src: "/images/event/sorento-hev.png", width: 385, height: 195 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
  {
    brand: "기아",
    name: "PV5",
    stock: "1대",
    tags: ["#특징1", "#특징1", "#특징1"],
    image: { src: "/images/event/pv5.png", width: 382, height: 185 },
    normalPrice: "99,000,000원",
    specialPrice: "69,000,000원",
    normalMonthly: "99",
    specialMonthly: "66",
  },
];

const FILTER_CHIPS = ["#가솔린", "#아이코닉", "#SUV"];

/** 시안 배경 위에 얹는 차량 이미지 슬롯 (시안 클롭이라 최적화 없이 원본 사용) */
function CarImage({ car }: { car: EventCar }) {
  return (
    <div
      className={`mt-[1.235cqw] lg:mt-3 h-[30.093cqw] lg:h-[170px] ${
        car.dark
          ? "-mx-[3.858cqw] w-[calc(100%_+_7.716cqw)] lg:mx-0 lg:w-full"
          : "w-full"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={car.image.src}
        alt={`${car.brand} ${car.name}`}
        className="h-full w-full object-contain"
        decoding="async"
      />
    </div>
  );
}

function TagRow({ tags }: { tags: string[] }) {
  return (
    <div className="flex items-center justify-end mx-[18.827cqw] mt-[4.630cqw] mb-[1.852cqw] gap-[1.852cqw] lg:mx-0 lg:mt-0 lg:mb-2.5 lg:gap-2">
      {tags.map((tag, i) => (
        <span
          key={`${tag}-${i}`}
          className="whitespace-nowrap font-semibold text-[2.932cqw] lg:text-[13px] text-[#4C69B4] bg-[#EAF0FF] rounded-full px-[2.160cqw] py-[0.926cqw] lg:px-3 lg:py-1.5"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

function PriceRows({ car }: { car: EventCar }) {
  const gray = car.dark ? "text-[#8F8F94]" : "text-[#9CA3AF]";
  const strong = car.dark ? "text-white" : "text-[#111827]";
  return (
    <div className="mt-[1.852cqw] lg:mt-3">
      <div className="flex items-center justify-between whitespace-nowrap">
        <div className="flex items-baseline gap-[2.469cqw] lg:gap-3">
          <span className={`text-[3.086cqw] lg:text-[14px] ${gray}`}>정상가</span>
          <span
            className={`text-[3.086cqw] lg:text-[14px] line-through ${gray}`}
          >
            {car.normalPrice}
          </span>
        </div>
        <div className="flex items-baseline gap-[0.309cqw] lg:gap-0.5">
          <span className={`text-[2.778cqw] lg:text-[12px] leading-none ${gray}`}>월</span>
          <span
            className={`font-bold text-[6.173cqw] lg:text-[28px] leading-none line-through ${gray}`}
          >
            {car.normalMonthly}
          </span>
          <span className={`text-[3.086cqw] lg:text-[14px] ${gray}`}>만원~</span>
        </div>
      </div>
      <div className="flex items-center justify-between whitespace-nowrap mt-[1.235cqw] lg:mt-1.5">
        <div className="flex items-baseline gap-[2.469cqw] lg:gap-3">
          <span className={`font-semibold text-[3.086cqw] lg:text-[14px] ${strong}`}>특별가</span>
          <span className={`font-semibold text-[3.086cqw] lg:text-[14px] ${strong}`}>
            {car.specialPrice}
          </span>
        </div>
        <div className="flex items-baseline gap-[0.309cqw] lg:gap-0.5">
          <span className="font-semibold text-[2.778cqw] lg:text-[12px] leading-none text-[#0150F5]">월</span>
          <span className={`font-extrabold text-[6.790cqw] lg:text-[32px] leading-none text-[#0150F5]`}>
            {car.specialMonthly}
          </span>
          <span className={`font-bold text-[3.395cqw] lg:text-[15px] text-[#0150F5]`}>만원~</span>
        </div>
      </div>
    </div>
  );
}

function VehicleCard({ car }: { car: EventCar }) {
  return (
    <section
      className={`mx-[18.827cqw] lg:mx-0 rounded-[3.704cqw] lg:rounded-[20px] px-[4.321cqw] pt-[3.086cqw] pb-[2.469cqw] lg:p-6 ${
        car.dark ? "bg-[#28292B]" : "bg-[#F8F9FE]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p
            className={`text-[3.704cqw] lg:text-[15px] leading-[1.2] ${
              car.dark ? "text-[#B4B4B8]" : "text-[#98989C]"
            }`}
          >
            {car.brand}
          </p>
          <h3
            className={`font-bold text-[4.630cqw] lg:text-[22px] leading-[1.2] mt-[0.617cqw] lg:mt-0.5 ${
              car.dark ? "text-white" : "text-[#111827]"
            }`}
          >
            {car.name}
          </h3>
        </div>
        <span
          className={`font-bold text-white text-[4.012cqw] lg:text-[16px] leading-none rounded-[2.160cqw] lg:rounded-[12px] px-[4.012cqw] py-[2.160cqw] lg:px-4 lg:py-2.5 ${
            car.dark ? "bg-[#0150F5]" : "bg-[#415DA7]"
          }`}
        >
          {car.stock}
        </span>
      </div>
      <CarImage car={car} />
      <PriceRows car={car} />
    </section>
  );
}

export default function EventPage() {
  return (
    <div className="bg-white font-sans">
      {/* 데스크톱 서비스 크롬 — 모바일은 시안대로 독립 랜딩 유지 */}
      <div className="hidden lg:block">
        <Suspense
          fallback={
            <div className="h-[72px] border-b border-border-subtle bg-surface/95" />
          }
        >
          <Header />
        </Suspense>
      </div>

      {/* 히어로 */}
      <header className="overflow-hidden bg-[linear-gradient(180deg,#221817_0%,#1D1A23_14%,#131C39_44%,#0A1F50_74%,#022161_100%)]">
        <div
          className="mx-auto w-full max-w-[648px] lg:max-w-[1140px] lg:flex lg:items-center lg:justify-between lg:gap-12 lg:px-8 lg:pt-14 lg:pb-16"
          style={{ containerType: "inline-size" }}
        >
          <div className="px-[6.173cqw] pt-[8.025cqw] pb-[14cqw] lg:px-0 lg:pt-0 lg:pb-0">
            <p className="font-bold text-white text-[4.321cqw] lg:text-[18px] leading-[1.2]">
              아임딜러AI <span className="text-[#0052FF]">OPEN EVENT</span>
            </p>
            <h1 className="font-extrabold text-white text-[9.567cqw] lg:text-[52px] leading-[1.15] mt-[2.160cqw] lg:mt-4">
              장기렌트 오픈 한정
              <br />
              특별판매 프로모션
            </h1>
            {/* 모바일 히어로 아트워크 — 제목과 할인 문구 사이 공간 활용 */}
            <div className="mt-[5cqw] lg:hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/event/open-event-cars-keyed.png"
                alt="특판 차량 라인업과 계약 혜택 +30만원"
                width={750}
                height={375}
                className="w-full h-auto [mask-image:linear-gradient(to_right,transparent_0%,black_14%)]"
                decoding="async"
              />
            </div>
            <p className="font-bold text-white text-[4.938cqw] lg:text-[22px] leading-[1.2] mt-[7cqw] lg:mt-10">
              00%이상 할인된 특판가
            </p>
            <span className="inline-block font-bold text-white text-[4.012cqw] lg:text-[16px] leading-none bg-[#0150F5] rounded-full px-[4.012cqw] py-[1.235cqw] lg:px-6 lg:py-2.5 mt-[0.926cqw] lg:mt-3">
              재고 소진 시 조기 종료
            </span>
          </div>
          {/* 데스크톱 히어로 아트워크 (홈 배너 소스의 배경 제거 버전) */}
          <div className="relative hidden lg:block shrink-0">
            <div className="absolute -inset-10 bg-[radial-gradient(closest-side,rgba(1,80,245,0.30),transparent)]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/event/open-event-cars-keyed.png"
              alt="특판 차량 라인업과 계약 혜택 +30만원"
              width={750}
              height={375}
              className="relative w-[440px] xl:w-[560px] h-auto [mask-image:linear-gradient(to_right,transparent_0%,black_14%)]"
              decoding="async"
            />
          </div>
        </div>
      </header>

      {/* 특판 차량 라인업 */}
      <main>
        <div className="pt-[10.802cqw] lg:pt-20">
          <div
            className="mx-auto w-full max-w-[648px] lg:max-w-[1140px]"
            style={{ containerType: "inline-size" }}
          >
            <div className="lg:px-8">
              <h2 className="font-extrabold text-[6.790cqw] lg:text-[34px] leading-[1.25] text-[#0150F5] mx-[6.173cqw] lg:mx-0">
                특판 차량 라인업
              </h2>
              <p className="font-medium text-[4.012cqw] lg:text-[17px] leading-[1.25] text-[#1A1A2E] mx-[6.173cqw] lg:mx-0 mt-[3.086cqw] lg:mt-2">
                차량별 특판가와 남은 재고를 확인하세요.
              </p>

              <div className="flex items-center justify-between mx-[18.827cqw] lg:mx-0 mt-[4.630cqw] lg:mt-8">
                <span className="whitespace-nowrap font-bold text-white text-[3.704cqw] lg:text-[16px] leading-none bg-[#0150F5] rounded-full px-[4.321cqw] py-[1.698cqw] lg:px-6 lg:py-2.5">
                  주목 차량
                </span>
                <div className="flex items-center gap-[1.235cqw] lg:gap-2">
                  {FILTER_CHIPS.map((chip) => (
                    <span
                      key={chip}
                      className="whitespace-nowrap font-semibold text-[2.932cqw] lg:text-[13px] text-[#4C69B4] bg-[#EAF0FF] rounded-full px-[2.160cqw] py-[0.926cqw] lg:px-3 lg:py-1.5"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-[1.852cqw] lg:mt-10 lg:grid lg:grid-cols-3 lg:gap-x-6 lg:gap-y-8">
                {CARS.map((car) => (
                  <div key={car.name}>
                    {car.tags && <TagRow tags={car.tags} />}
                    <VehicleCard car={car} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 쿠폰 섹션 */}
      <section className="bg-[#0150F5] mt-[11.111cqw] lg:mt-24 py-[10.802cqw] px-[5.864cqw] lg:py-20 lg:px-8">
        <div className="mx-auto w-full max-w-[648px] lg:max-w-[1140px]">
          <h2 className="font-extrabold text-white text-[6.790cqw] lg:text-[34px] leading-[1.25]">
            아임딜러 특별 오픈 이벤트
          </h2>
          <p className="font-medium text-white text-[4.012cqw] lg:text-[17px] leading-[1.25] mt-[3.086cqw] lg:mt-2">
            특판가에 30만원 혜택까지?!
          </p>
          <div className="relative mt-[6.790cqw] lg:mt-12 lg:max-w-[620px] lg:mx-auto">
            <span className="absolute top-0 left-1/2 -translate-x-1/2 whitespace-nowrap font-extrabold text-[3.704cqw] lg:text-[15px] leading-none text-[#0150F5] bg-white rounded-full px-[5.556cqw] py-[1.543cqw] lg:px-7 lg:py-2 shadow-[0_0.617cqw_0_#01143E] lg:shadow-[0_3px_0_#01143E]">
              SPECIAL COUPON
            </span>
            <div className="text-center bg-[#F8F9FE] rounded-[4.321cqw] lg:rounded-[24px] shadow-[0.926cqw_0.926cqw_0_#01143E] lg:shadow-[8px_8px_0_#01143E] px-[3.704cqw] pt-[8.025cqw] pb-[5.864cqw] lg:px-8 lg:pt-14 lg:pb-10">
              <p className="flex items-baseline justify-center font-extrabold gap-[2.778cqw] lg:gap-4">
                <span className="text-[6.790cqw] lg:text-[30px] leading-[1.2] text-[#111827]">
                  계약 혜택
                </span>
                <span className="text-[8.951cqw] lg:text-[40px] leading-[1.2] text-[#0150F5]">
                  +30만원
                </span>
              </p>
              <p className="text-[3.704cqw] lg:text-[15px] leading-[1.2] text-[#6B7280] mt-[4.012cqw] lg:mt-5">
                이벤트 기간 내 계약 완료 고객 대상
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 데스크톱 서비스 푸터 */}
      <div className="hidden lg:block">
        <Footer />
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { VehicleListItem } from "@/types/api";
import { RepresentativeQuotePrice } from "@/components/cars/RepresentativeQuotePrice";
import { isSupabaseStorageUrl } from "@/lib/image-url";

type HeroSectionV2Props = {
  readonly featuredVehicle?: VehicleListItem;
};

export function HeroSectionV2({ featuredVehicle }: HeroSectionV2Props) {
  return (
    <section className="bg-white">
      <div className="mx-auto w-full max-w-[1120px] px-5 pb-10 pt-10 max-[340px]:px-4 max-[340px]:pt-8 md:px-8 md:pb-16 md:pt-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)] lg:items-center lg:gap-16">
          {/* 좌측: 카피 + CTA + 검색 */}
          <div className="min-w-0">
            <h1 className="max-w-[560px] break-keep text-[34px] font-extrabold leading-[1.15] tracking-[-0.04em] text-text-strong max-[340px]:text-[30px] md:text-[52px] md:leading-[1.1]">
              진짜 견적,
              <br />
              <span className="mt-2 inline-block md:mt-3">어떤 차를 알아볼까요?</span>
            </h1>
            <p className="mt-5 max-w-[440px] break-keep text-[15px] font-medium leading-[1.7] text-text-body md:mt-6 md:text-[17px]">
              견적부터 계약까지 내가 직접 딜러가 되어보세요!
              <br />
              상담은 원할 때만 이어갑니다.
            </p>

            <div className="mt-8 flex flex-row items-center gap-2.5">
              <Link
                href="/recommend"
                className="flex h-[56px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-brand px-3 text-[16px] font-bold text-white shadow-[0_4px_12px_rgba(39,54,138,0.18)] transition-all hover:bg-brand-pressed active:scale-[0.99] max-[340px]:text-[14px] sm:w-[180px] sm:flex-none md:text-[17px]"
              >
                AI 추천 받기
                <ArrowRight size={17} strokeWidth={2.4} />
              </Link>
              <Link
                href="/cars"
                className="flex h-[56px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[14px] bg-[#EEF1F6] px-3 text-[16px] font-bold text-text-strong ring-[1.5px] ring-brand/35 transition-all hover:bg-[#E5E9F2] hover:ring-brand/55 active:scale-[0.99] max-[340px]:text-[14px] sm:w-[180px] sm:flex-none md:text-[17px]"
              >
                내 차량 견적내기
              </Link>
            </div>

            {/* 오픈 한정 특가 이벤트 배너 */}
            <Link
              href="/event"
              aria-label="오픈 한정 특가 이벤트 — 차종별 300~500만원 할인, 재고 소진 전 확인하기"
              className="group relative mt-10 block overflow-hidden rounded-[16px] bg-[#04060E] shadow-[0_12px_32px_rgba(4,10,30,0.35)] transition-transform active:scale-[0.99] max-[340px]:mt-8"
            >
              {/* 블루 글로우 배경 */}
              <div aria-hidden className="absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(120%_180%_at_72%_45%,rgba(37,99,235,0.42)_0%,rgba(9,14,34,0.85)_48%,#04060E_100%)]" />
              </div>

              {/* 차량 클러스터 아트웍 */}
              <Image
                src="/images/event/open-event-cars.png"
                alt=""
                width={750}
                height={375}
                className="pointer-events-none absolute right-0 top-1/2 h-full w-auto -translate-y-1/2 select-none transition-transform duration-500 group-hover:scale-[1.02] [mask-image:linear-gradient(to_right,transparent,black_20%),linear-gradient(to_bottom,black,black)] [mask-composite:intersect] max-sm:top-auto max-sm:bottom-0 max-sm:translate-y-0 max-sm:[mask-image:linear-gradient(to_right,transparent,black_34%),linear-gradient(to_bottom,black,black)]"
              />
              {/* 텍스트 가독성 스크림 — 모바일에서 차량과 카피 겹침 대비 */}
              <div
                aria-hidden
                className="absolute inset-y-0 left-0 z-[1] w-[56%] bg-gradient-to-r from-[#04060E] via-[#04060E]/55 to-transparent max-sm:w-[64%]"
              />

              {/* 카피 */}
              <div className="relative z-10 px-5 py-6 max-[340px]:px-4 max-[340px]:py-5 md:px-7 md:py-7">
                <p className="text-[18px] font-extrabold leading-[1.32] tracking-[-0.02em] text-white max-[340px]:text-[16px] md:text-[21px]">
                  오픈 한정 <span className="text-[#3D6BFF]">NO</span> 마진!
                  <br />
                  차종별 300~500만원 할인
                </p>
                <p className="mt-2.5 inline-flex items-center gap-0.5 text-[12.5px] font-bold text-white/85 md:text-[13.5px]">
                  재고 소진 전 확인하기
                  <ChevronRight
                    size={14}
                    strokeWidth={2.6}
                    className="transition-transform duration-200 group-hover:translate-x-0.5"
                  />
                </p>
              </div>
            </Link>
          </div>

          {/* 우측: 인기 차량 1장 (데스크톱만) */}
          {featuredVehicle && (
            <FeaturedVehicleCard vehicle={featuredVehicle} />
          )}
        </div>
      </div>
    </section>
  );
}

// ─── 데스크톱 우측 인기 차량 카드 ─────────────────────────
function FeaturedVehicleCard({ vehicle }: { vehicle: VehicleListItem }) {
  return (
    <Link
      href={`/cars/${vehicle.slug}`}
      className="group hidden overflow-hidden rounded-[24px] bg-[#F8FAFC] p-5 transition-all duration-200 hover:bg-white hover:ring-[1.5px] hover:ring-brand lg:block"
    >
      {/* 인기 라벨 */}
      <div className="mb-4 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand">
          <span className="inline-flex rounded-full bg-brand px-2 py-0.5 text-[10px] font-extrabold text-white">
            인기
          </span>
          이번 주 가장 많이 본 차량
        </span>
      </div>

      {/* 썸네일 */}
      <div className="relative mb-5 aspect-[16/10] w-full overflow-hidden rounded-[16px] bg-white">
        {vehicle.thumbnailUrl ? (
          <Image
            src={vehicle.thumbnailUrl}
            alt={vehicle.name}
            fill
            sizes="(max-width: 1024px) 100vw, 420px"
            unoptimized={isSupabaseStorageUrl(vehicle.thumbnailUrl)}
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[13px] font-bold text-text-muted">
            이미지 준비 중
          </div>
        )}
      </div>

      {/* 차량 정보 */}
      <p className="text-[12.5px] font-bold text-text-muted">{vehicle.brand}</p>
      <h3 className="mt-1 text-[22px] font-extrabold leading-tight text-text-strong transition-colors group-hover:text-brand">
        {vehicle.name}
      </h3>
      {vehicle.defaultTrim && (
        <p className="mt-1 text-[13.5px] text-text-body">
          {vehicle.defaultTrim.engineType} · {vehicle.defaultTrim.name}
        </p>
      )}

      {/* 구분선 */}
      <div className="my-5 h-[1px] bg-[#E5E8EB]" />

      {/* 월 납입금 — 큰 타이포 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <RepresentativeQuotePrice
            quotes={vehicle.representativeQuotes}
            tone="brand"
            size="xl"
            captionText="월 납입금 · 60개월 · 연 2만km · 무보증"
            captionClassName="mb-1.5 text-[12px] font-bold leading-none text-text-muted"
            numberClassName="text-[36px]"
            unitClassName="text-[15px] font-bold"
          />
        </div>
        <span className="inline-flex h-10 shrink-0 items-center gap-1 rounded-[12px] bg-white px-4 text-[13px] font-bold text-text-body ring-[1px] ring-[#E5E8EB] transition-all group-hover:bg-brand group-hover:text-white group-hover:ring-brand">
          견적
          <ArrowRight size={13} strokeWidth={2.5} />
        </span>
      </div>
    </Link>
  );
}

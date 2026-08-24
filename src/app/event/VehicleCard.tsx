"use client";

export interface EventCar {
  id: string;
  brand: string;
  model: string;
  option: string;
  stock: string;
  image: string;
  wasMonthly: string;
  nowMonthly: string;
  discount: string;
  listPrice: string;
  featured?: boolean;
}

function ArrowIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      className={className}
      aria-hidden="true"
    >
      <path
        d="M5 12h14m-6-6 6 6-6 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VehicleCard({ car }: { car: EventCar }) {
  const featured = car.featured === true;

  return (
    <button
      type="button"
      onClick={() => undefined}
      className={`block w-full cursor-pointer rounded-[20px] p-4 text-left transition-all duration-200 ease-out hover:scale-[1.02] hover:shadow-[0_14px_36px_rgba(13,26,64,0.16)] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0150F5] focus-visible:ring-offset-2 ${
        featured
          ? "bg-[#2D2F36] shadow-[0_12px_30px_rgba(15,18,28,0.38)]"
          : "border border-[#E6E8EE] bg-white shadow-[0_6px_20px_rgba(13,26,64,0.06)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p
            className={`text-[12px] font-medium leading-none ${
              featured ? "text-[#C5C8D0]" : "text-[#8B8F9A]"
            }`}
          >
            {car.brand}
          </p>
          <p
            className={`mt-1.5 text-[17px] font-extrabold leading-[1.25] ${
              featured ? "text-white" : "text-[#111827]"
            }`}
          >
            {car.model}
          </p>
          <p
            className={`mt-1 text-[12px] leading-[1.35] ${
              featured ? "text-[#A7ACB6]" : "text-[#8B8F9A]"
            }`}
          >
            {car.option}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {featured ? (
            <span className="rounded-[6px] bg-[#0066FF] px-2 py-1 text-[11px] font-bold leading-none text-white">
              주목 차량
            </span>
          ) : null}
          <span
            className={`rounded-[6px] px-2 py-1 text-[11px] font-bold leading-none ${
              featured
                ? "bg-white text-[#111827]"
                : "bg-[#F3F4F6] text-[#111827]"
            }`}
          >
            {car.stock}
          </span>
        </div>
      </div>

      <div className="mt-3 h-[124px] w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={car.image}
          alt={`${car.brand} ${car.model}`}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-2 gap-y-1">
        <span
          className={`text-[13px] font-semibold line-through ${
            featured ? "text-[#9AA0AB]" : "text-[#B0B4BD]"
          }`}
        >
          월 {car.wasMonthly}만원
        </span>
        <ArrowIcon className="mb-0.5 h-4 w-4 shrink-0 text-[#0066FF]" />
        <span className="flex items-baseline gap-0.5 text-[#0066FF]">
          <span className="text-[13px] font-bold leading-none">월</span>
          <span className="text-[32px] font-extrabold leading-none">
            {car.nowMonthly}
          </span>
          <span className="text-[13px] font-bold leading-none">만원</span>
        </span>
      </div>

      <span className="mt-2 inline-flex rounded-full bg-[#FF4A4A] px-2.5 py-1 text-[12px] font-extrabold leading-none text-white">
        {car.discount} 할인
      </span>

      <p
        className={`mt-3 text-[11px] leading-[1.45] ${
          featured ? "text-[#9AA0AB]" : "text-[#9AA0AB]"
        }`}
      >
        차량가 {car.listPrice}
        <br />
        60개월 · 초기비용 0원 · 연 2만km 기준
      </p>
    </button>
  );
}

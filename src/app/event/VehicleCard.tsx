"use client";

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

// Fades the baked-in studio plate (bottom) and faint backdrop edges so the
// PNG dissolves into the card instead of ending in a hard rectangular cut.
const CAR_IMAGE_MASK = [
  "linear-gradient(to top, transparent 6%, black 25%)",
  "linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)",
  "linear-gradient(to bottom, transparent 0%, black 5%)",
].join(", ");

function StockBadge({ stock }: { stock: string }) {
  return (
    <span className="shrink-0 rounded-[6px] bg-[#E8F1FF] px-2 py-1 text-[11px] font-bold leading-none text-[#1A73E8]">
      {stock}
    </span>
  );
}

export function VehicleCard({ car }: { car: EventCar }) {
  const featured = Boolean(car.featured);

  const subText = featured ? "text-[#9CA3AF]" : "text-[#8A8F98]";

  return (
    <button
      type="button"
      onClick={() => undefined}
      className={[
        "w-full cursor-pointer rounded-[20px] px-4 pb-4 pt-3.5 text-left transition-transform duration-150",
        "hover:scale-[1.02] active:scale-[0.98]",
        featured ? "bg-[#2B2D33]" : "bg-white shadow-[0_6px_18px_rgba(17,24,39,0.06)]",
      ].join(" ")}
    >
      {featured ? (
        <div className="mb-2 flex items-center justify-between">
          <span className="rounded-[6px] bg-[#FFE14D] px-2 py-1 text-[11px] font-extrabold leading-none text-black">
            주목 차량
          </span>
          <StockBadge stock={car.stock} />
        </div>
      ) : null}

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[12px] leading-none ${featured ? "text-[#C5C8CE]" : "text-[#8A8F98]"}`}>
            {car.brand}
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
            <span className={`text-[18px] font-extrabold leading-tight ${featured ? "text-white" : "text-black"}`}>
              {car.model}
            </span>
            {car.trim ? (
              <span className={`text-[12px] leading-tight ${featured ? "text-[#B0B4BC]" : "text-[#555555]"}`}>
                {car.trim}
              </span>
            ) : null}
          </p>
          {car.option ? (
            <p className={`mt-1 text-[11px] leading-[1.35] ${subText}`}>
              {car.option}
            </p>
          ) : null}
        </div>
        {featured ? null : <StockBadge stock={car.stock} />}
      </div>

      <div className="mt-3 flex h-[144px] items-center justify-center drop-shadow-[0_12px_14px_rgba(0,0,0,0.20)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={car.image}
          alt={`${car.brand} ${car.model}`}
          className="max-h-full max-w-full object-contain"
          style={{
            WebkitMaskImage: CAR_IMAGE_MASK,
            maskImage: CAR_IMAGE_MASK,
            WebkitMaskComposite: "source-in",
            maskComposite: "intersect",
          }}
          decoding="async"
          onError={(e) => {
            e.currentTarget.style.visibility = "hidden";
          }}
        />
      </div>

      <div className="mt-3 text-center">
        <div className="flex items-end justify-center gap-1.5">
          <span className={`flex items-baseline gap-px ${subText}`}>
            <span className="text-[14px]">월</span>
            <span className="text-[26px] font-bold leading-none line-through">{car.wasMonthly}</span>
            <span className="text-[14px]">만원</span>
          </span>
          <span className={`mb-1 text-[16px] ${subText}`}>&gt;</span>
          <span className="flex items-baseline gap-px text-[#1A73E8]">
            <span className="text-[14px] font-bold">월</span>
            <span className="text-[35px] font-extrabold leading-none">{car.nowMonthly}</span>
            <span className="text-[14px] font-bold">만원</span>
          </span>
        </div>
        <p className={`mt-1 text-[12px] ${subText}`}>
          차량가 {car.listPrice}
        </p>
        <span className="mt-2 inline-flex min-w-[170px] justify-center rounded-full bg-[#FFF0F0] px-6 py-2 text-[16px] font-extrabold text-[#FF5A2E]">
          {car.discount} 할인
        </span>
        <p className={`mt-2 text-[11px] ${subText}`}>
          60개월 · 초기비용 0원 · 연 2만km 기준
        </p>
      </div>
    </button>
  );
}

import { cn } from "@/lib/utils";

/**
 * 카카오 CTA 버튼 위에 띄우는 "영업전화 가지 않아요~!" 안심 말풍선.
 * 꼬리를 축으로 도리도리 흔들린다(motion-safe). 버튼을 감싼 relative 컨테이너 안에서 쓴다.
 */
export function NoSalesCallBalloon({ className }: { readonly className?: string }) {
  return (
    <span
      className={cn(
        "pointer-events-none absolute -top-[34px] right-4 z-10 origin-bottom rounded-full bg-[var(--color-kakao-ink)] px-4 py-2 text-[13.5px] font-extrabold leading-tight text-white shadow-card motion-safe:animate-headshake after:absolute after:-bottom-[4px] after:right-6 after:h-2 after:w-2 after:rotate-45 after:bg-[var(--color-kakao-ink)] after:content-['']",
        className,
      )}
    >
      영업전화 가지 않아요~!
    </span>
  );
}

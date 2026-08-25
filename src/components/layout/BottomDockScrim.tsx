/**
 * 하단 고정 CTA 바 뒤에 까는 은은한 블러 스크림.
 * 아래로 갈수록 배경색+블러가 짙어지고 위로는 부드럽게 사라져,
 * 버튼이 콘텐츠 위에 "떠 있다"는 분리감을 만든다. 하드 엣지가 없어 카드처럼 보이진 않는다.
 */
export function BottomDockScrim() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 -top-8 bottom-0 bg-gradient-to-t from-surface/85 via-surface/45 to-transparent backdrop-blur-[5px] [mask-image:linear-gradient(to_top,black_58%,transparent)]"
    />
  );
}

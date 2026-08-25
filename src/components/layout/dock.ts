/**
 * 화면 바닥 ↔ 떠 있는 하단 도크(메뉴바, 견적서 받기 바) 간격.
 * safe-area inset 은 패딩 공식에서 별도로 더한다.
 */
export const DOCK_BOTTOM_GAP = "28px";

/**
 * `calc(DOCK_BOTTOM_GAP + env(safe-area-inset-bottom, 0px))`
 * Tailwind JIT 가 스캔하도록 28px 리터럴을 클래스에 둔다. DOCK_BOTTOM_GAP 과 맞춰 유지.
 */
export const DOCK_BOTTOM_PADDING_CLASS =
  "pb-[calc(28px+env(safe-area-inset-bottom,0px))]";

/** 메뉴바(64) + 바닥 여백(28) + CTA 간격(8) */
export const STACK_OFFSET_EXPANDED = "100px";

/** 축소 FAB 위쪽 — 펼침 메뉴바와 동일하게 독을 항상 네비/FAB 위에 올린다 */
export const STACK_OFFSET_COLLAPSED = "100px";

/**
 * 펼친 메뉴바가 푸터를 가리지 않게.
 * 기존 96px = 64+16+16 → 64+28+16 = 108
 */
export const FOOTER_ABOVE_DOCK_PADDING_CLASS =
  "pb-[calc(108px+env(safe-area-inset-bottom,0px))]";

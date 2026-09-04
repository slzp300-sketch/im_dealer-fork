"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion, type Transition } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CarFront, ClipboardCheck, Home, Menu, MessageCircle, type LucideIcon } from "lucide-react";
import { KakaoConsultGuideModal } from "@/components/layout/KakaoConsultGuideModal";
import {
  DOCK_BOTTOM_PADDING_CLASS,
  STACK_OFFSET_COLLAPSED,
  STACK_OFFSET_EXPANDED,
} from "./dock";

interface NavItem {
  href?: string;
  label: string;
  icon: LucideIcon;
  exact: boolean;
  consultation?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈", icon: Home, exact: true },
  { href: "/recommend", label: "AI 추천", icon: ClipboardCheck, exact: false },
  { href: "/cars", label: "차량 탐색", icon: CarFront, exact: false },
  { label: "상담", icon: MessageCircle, exact: false, consultation: true },
];

/**
 * sticky CTA 등이 하단 네비와 맞출 때 쓰는 스택 오프셋 (safe-area 제외)
 * - 펼침: 전체 메뉴바 위
 * - 축소: 중앙 FAB과 같은 바닥선(나란히)
 *
 * 메뉴바 자체는 화면 바닥에서 DOCK_BOTTOM_GAP 만큼 띄운다.
 */
const CSS_VAR_STACK_OFFSET = "--bottom-nav-stack-offset";
const CSS_VAR_NAV_COLLAPSED = "--bottom-nav-collapsed";

/** 스크롤 다운 누적이 이 값을 넘으면 접기 (중간 스크롤 업으로는 펼치지 않음) */
const SCROLL_DOWN_COLLAPSE_THRESHOLD_PX = 20;
/**
 * 문서 최상단 근처에서만 자동 펼침.
 * 중간에서 올리는 동작으로는 절대 펼치지 않는다.
 */
const SCROLL_TOP_ALWAYS_EXPAND = 12;
/** 축소 FAB 지름 — sticky CTA 중앙 스페이서와 맞춤 */
const FAB_SIZE_CLASS = "h-16 w-16";

function getScrollY() {
  if (typeof window === "undefined") return 0;
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

function setStackOffset(collapsed: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(
    CSS_VAR_STACK_OFFSET,
    collapsed ? STACK_OFFSET_COLLAPSED : STACK_OFFSET_EXPANDED,
  );
  document.documentElement.style.setProperty(CSS_VAR_NAV_COLLAPSED, collapsed ? "1" : "0");
  document.documentElement.dataset.bottomNavCollapsed = collapsed ? "true" : "false";
}

function clearStackOffset() {
  if (typeof document === "undefined") return;
  document.documentElement.style.removeProperty(CSS_VAR_STACK_OFFSET);
  document.documentElement.style.removeProperty(CSS_VAR_NAV_COLLAPSED);
  delete document.documentElement.dataset.bottomNavCollapsed;
}

export function BottomNav() {
  const pathname = usePathname() ?? "";
  const isHome = pathname === "/";
  const prefersReducedMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(false);
  const [kakaoGuideOpen, setKakaoGuideOpen] = useState(false);
  const collapsedRef = useRef(false);
  const lastScrollY = useRef(0);
  const downAccum = useRef(0);

  const tapAnimation = prefersReducedMotion ? undefined : { scale: 0.96 };
  const springTransition: Transition | undefined = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 420, damping: 28, mass: 0.85 };
  const dockTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 380, damping: 30, mass: 0.9 };
  const fabTransition: Transition = prefersReducedMotion
    ? { duration: 0 }
    : { type: "spring", stiffness: 460, damping: 24, mass: 0.7 };

  const activeIconAnimation = prefersReducedMotion
    ? { opacity: activeOpacity(true) }
    : { y: -1, scale: 1.02 };
  const inactiveIconAnimation = prefersReducedMotion
    ? { opacity: activeOpacity(false) }
    : { y: 0, scale: 1 };

  // 견적·추천·후기작성 플로우는 단일 작업 화면이므로 탭바와 겹침 방지
  // /recommend/result(추천 결과)는 완료 화면이라 하단 CTA가 잘 보이도록 숨김.
  const hidden =
    pathname.startsWith("/quote") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/verify") ||
    pathname.startsWith("/recommend") ||
    pathname.startsWith("/reviews/write");

  const expand = useCallback(() => {
    downAccum.current = 0;
    lastScrollY.current = getScrollY();
    collapsedRef.current = false;
    setCollapsed(false);
  }, []);
  const closeKakaoGuide = useCallback(() => setKakaoGuideOpen(false), []);

  useEffect(() => {
    collapsedRef.current = collapsed;
  }, [collapsed]);

  useEffect(() => {
    if (hidden) {
      clearStackOffset();
      return;
    }
    setStackOffset(collapsed);
  }, [collapsed, hidden]);

  useEffect(() => {
    if (hidden) return;

    lastScrollY.current = getScrollY();
    downAccum.current = 0;

    const onScroll = () => {
      const y = getScrollY();
      const dy = y - lastScrollY.current;
      // 이벤트마다 lastY 갱신 — rAF 스로틀로 방향을 놓치지 않도록 동기 처리
      lastScrollY.current = y;

      // 1) 문서 최상단 근처: 자동 펼침
      if (y <= SCROLL_TOP_ALWAYS_EXPAND) {
        downAccum.current = 0;
        if (collapsedRef.current) {
          collapsedRef.current = false;
          setCollapsed(false);
        }
        return;
      }

      // 2) 스크롤 업(중간): 절대 펼치지 않음
      if (dy <= 0) {
        downAccum.current = 0;
        return;
      }

      // 3) 스크롤 다운만 접기
      downAccum.current += dy;
      if (downAccum.current >= SCROLL_DOWN_COLLAPSE_THRESHOLD_PX && !collapsedRef.current) {
        downAccum.current = 0;
        collapsedRef.current = true;
        setCollapsed(true);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearStackOffset();
    };
  }, [hidden]);

  if (hidden) {
    return null;
  }

  const isActive = (href: string | undefined, exact: boolean, consultation?: boolean) => {
    if (consultation || !href) return false;
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  const activeItem =
    NAV_ITEMS.find((item) => isActive(item.href, item.exact, item.consultation)) ?? NAV_ITEMS[0];
  const ActiveIcon = activeItem.icon;

  return (
    <nav
      className={cn(
        "pointer-events-none fixed bottom-0 left-0 right-0 z-50 px-3 lg:hidden",
        isHome && "home-showroom-scope",
      )}
      aria-label="하단 메뉴"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <div className={cn("relative", DOCK_BOTTOM_PADDING_CLASS)}>
        <AnimatePresence initial={false} mode="popLayout">
          {!collapsed ? (
            <motion.div
              key="bottom-nav-expanded"
              className="pointer-events-auto relative mx-auto grid h-[64px] max-w-[480px] grid-cols-4 overflow-hidden rounded-card-lg border border-border-subtle bg-surface-glass px-1 shadow-mobile-float backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150"
              initial={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 0, y: 28, scale: 0.94, filter: "blur(4px)" }
              }
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, y: 36, scale: 0.9, filter: "blur(6px)" }
              }
              transition={dockTransition}
            >
              {NAV_ITEMS.map(({ href, label, icon: Icon, exact, consultation }) => {
                const active = isActive(href, exact, consultation);

                const inner = (
                  <motion.span
                    className="relative flex min-h-11 w-full cursor-pointer select-none flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1"
                    whileTap={tapAnimation}
                    transition={springTransition}
                  >
                    <motion.span
                      className={cn(
                        "relative z-10 flex h-8 min-w-8 items-center justify-center rounded-full transition-colors duration-state",
                        active ? "bg-brand-soft text-brand" : "bg-transparent text-text-muted",
                      )}
                      animate={active ? activeIconAnimation : inactiveIconAnimation}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 400, damping: 25 }
                      }
                    >
                      <Icon
                        size={active ? 18 : 17}
                        strokeWidth={active ? 2.35 : 1.85}
                        className="transition-colors duration-state"
                      />
                    </motion.span>

                    <motion.span
                      className={cn(
                        "relative z-10 whitespace-nowrap text-[10px] font-bold leading-none tracking-normal transition-colors duration-state",
                        active ? "text-text-strong" : "text-text-muted",
                      )}
                      animate={{ opacity: activeOpacity(active) }}
                    >
                      {label}
                    </motion.span>
                  </motion.span>
                );

                const wrapperClass = cn(
                  "flex min-h-11 items-center justify-center rounded-[15px] px-0.5 transition-colors duration-state",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                  active ? "bg-surface" : "hover:bg-surface-soft active:bg-surface-soft",
                );

                if (consultation) {
                  return (
                    <button
                      key="consultation"
                      type="button"
                      className={wrapperClass}
                      aria-label={label}
                      onClick={() => setKakaoGuideOpen(true)}
                    >
                      {inner}
                    </button>
                  );
                }

                if (!href) return null;

                return (
                  <Link
                    key={href}
                    href={href}
                    className={wrapperClass}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                  >
                    {inner}
                  </Link>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key="bottom-nav-fab"
              className="pointer-events-none flex justify-center"
              initial={
                prefersReducedMotion
                  ? { opacity: 1 }
                  : { opacity: 0, scale: 0.45, y: 18 }
              }
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={
                prefersReducedMotion
                  ? { opacity: 0 }
                  : { opacity: 0, scale: 0.55, y: 10 }
              }
              transition={fabTransition}
            >
              <motion.button
                type="button"
                aria-label="메뉴 열기"
                aria-expanded={false}
                onClick={expand}
                whileTap={prefersReducedMotion ? undefined : { scale: 0.92 }}
                className={cn(
                  "relative flex items-center justify-center rounded-full",
                  FAB_SIZE_CLASS,
                  "pointer-events-auto",
                  "border border-border-subtle bg-surface-glass text-text-strong shadow-mobile-float",
                  "backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150",
                  "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                )}
              >
                <span className="absolute inset-0 rounded-full bg-brand-soft/45" aria-hidden />
                <ActiveIcon size={24} strokeWidth={2.2} className="relative z-10 text-brand" />
                <span
                  className="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand text-white shadow-sm"
                  aria-hidden
                >
                  <Menu size={12} strokeWidth={2.6} />
                </span>
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <KakaoConsultGuideModal
        open={kakaoGuideOpen}
        onClose={closeKakaoGuide}
      />
    </nav>
  );
}

function activeOpacity(active: boolean) {
  return active ? 1 : 0.78;
}

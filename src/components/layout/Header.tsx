"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CarFront, ClipboardCheck, Home, Info, MessageCircle } from "lucide-react";
import { isChannelTalkSuppressedPath, openChannelTalk } from "@/lib/channel-talk";
import {
  isChannelTalkEnabled,
  useChannelTalkStatus,
} from "@/lib/channel-talk-status";
import { cn } from "@/lib/utils";
import { HeaderConsultButton } from "@/components/layout/HeaderConsultButton";
import { MyMenuButton } from "@/components/layout/MyMenuButton";

const NAV_LINKS = [
  { href: "/", label: "홈", icon: Home, exact: true },
  { href: "/recommend", label: "AI 추천", icon: ClipboardCheck, exact: false },
  { href: "/cars", label: "차량 탐색", icon: CarFront, exact: false },
  { href: "/about", label: "소개", icon: Info, exact: false },
] as const;

export function Header() {
  const pathname = usePathname() ?? "";
  const isHome = pathname === "/";
  const channelTalkSuppressed = isChannelTalkSuppressedPath(pathname);
  const channelTalkEnabled = isChannelTalkEnabled(useChannelTalkStatus());

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header
      className={cn(
        "sticky top-0 z-[70] border-b border-border-subtle bg-surface-glass backdrop-blur-xl supports-[backdrop-filter]:backdrop-saturate-150",
        isHome && "home-showroom-scope",
      )}
    >
      <div className="mx-auto w-full max-w-[1440px] px-4 sm:px-5 lg:px-8">
        <div className="relative flex h-14 items-center lg:h-[72px]">
          {/* 로고 */}
          <Link
            href="/"
            className="flex min-h-11 items-center rounded-btn focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            aria-label="아임딜러 홈"
          >
            <Image
              src="/images/brand/main-logo.svg"
              alt="아임딜러"
              width={137}
              height={28}
              priority
              loading="eager"
              unoptimized
              className="public-brand-logo block h-5 w-[98px] object-contain lg:h-7 lg:w-[137px]"
            />
          </Link>

          {/* 데스크톱 네비게이션 */}
          <nav
            className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-pill border border-border-subtle bg-surface-soft p-1 lg:flex"
            aria-label="주요 메뉴"
          >
            {NAV_LINKS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "relative inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-bold transition-all duration-state focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98]",
                    active
                      ? "bg-surface text-brand shadow-card"
                      : "text-text-body hover:bg-surface hover:text-text-strong",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={17} strokeWidth={active ? 2.4 : 2} />
                  {label}
                </Link>
              );
            })}
            {!channelTalkSuppressed && (
              <button
                type="button"
                onClick={openChannelTalk}
                disabled={!channelTalkEnabled}
                title={channelTalkEnabled ? undefined : "잠시 후 다시"}
                className="inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-[14px] font-bold text-text-body transition-all duration-state hover:bg-surface hover:text-text-strong focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
              >
                <MessageCircle size={17} strokeWidth={2} />
                {channelTalkEnabled ? "상담" : "채팅 준비 중"}
              </button>
            )}
          </nav>

          {/* 우측: 상담 + My */}
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <HeaderConsultButton />
            <MyMenuButton />
          </div>
        </div>
      </div>
    </header>
  );
}

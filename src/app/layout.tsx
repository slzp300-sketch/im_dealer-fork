import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import { PUBLIC_VIEWPORT, ROOT_TOUCH_ACTION } from "@/lib/public-viewport";
import {
  HOME_TITLE,
  SITE_DESCRIPTION,
  SITE_LEGAL_NAME,
  SITE_NAME,
  SITE_URL,
  absoluteSiteUrl,
} from "@/lib/site-config";
import "./globals.css";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  style: "normal",
  display: "swap",
});

export const viewport = PUBLIC_VIEWPORT;
const rootHtmlStyle = { touchAction: ROOT_TOUCH_ACTION } as const;
const naverSiteVerification =
  process.env.NAVER_SITE_VERIFICATION?.trim() || undefined;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: HOME_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  authors: [{ name: SITE_LEGAL_NAME, url: SITE_URL }],
  creator: SITE_LEGAL_NAME,
  publisher: SITE_LEGAL_NAME,
  openGraph: {
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    locale: "ko_KR",
    type: "website",
    siteName: SITE_NAME,
    images: [
      {
        url: absoluteSiteUrl("/images/hero-bg-v3.png"),
        width: 1716,
        height: 917,
        alt: "아임딜러 장기렌트·운용리스 견적 비교 서비스",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
    images: [absoluteSiteUrl("/images/hero-bg-v3.png")],
  },
  verification: naverSiteVerification
    ? {
        other: {
          "naver-site-verification": naverSiteVerification,
        },
      }
    : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ko" className={pretendard.variable} style={rootHtmlStyle}>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}

import type { SiteAdapter } from "./types";
import { pilotCompanyAdapter } from "./pilot-company";
import { orixAdapter } from "./orix";
import { woorifcAdapter } from "./woorifc";
import { shinhanAdapter } from "./shinhan";
import { jbwooriAdapter } from "./jbwoori";
import { bnkAdapter } from "./bnk";

/**
 * 캐피탈사 → 어댑터 매핑.
 * 작업의 credential.config.adapter 값(없으면 "PILOT")으로 선택한다.
 * 사이트가 늘면 어댑터를 추가하고 여기 등록한다.
 */
const ADAPTERS: Record<string, SiteAdapter> = {
  PILOT: pilotCompanyAdapter,
  ORIX: orixAdapter,
  WOORIFC: woorifcAdapter,
  SHINHAN: shinhanAdapter,
  JBWOORI: jbwooriAdapter,
  BNK: bnkAdapter,
};

/** 로그인 URL 호스트 → 어댑터 자동 인식 (config.adapter 미지정 시). */
function inferAdapterFromUrl(loginUrl?: string): string | null {
  if (!loginUrl) return null;
  try {
    const host = new URL(loginUrl).hostname.toLowerCase();
    if (host.includes("orix")) return "ORIX";
    if (host.includes("woorifcapital")) return "WOORIFC";
    if (host.includes("shinhancard")) return "SHINHAN";
    if (host.includes("wooricap")) return "JBWOORI";
    if (host.includes("bnkcapital")) return "BNK";
  } catch {
    /* 무시 */
  }
  return null;
}

export function resolveAdapter(
  config: Record<string, unknown> | null,
  loginUrl?: string
): SiteAdapter | null {
  // 우선순위: config.adapter 명시 → 로그인 URL 자동 인식 → PILOT(기본)
  const key = (config?.adapter as string) || inferAdapterFromUrl(loginUrl) || "PILOT";
  return ADAPTERS[key] ?? null;
}

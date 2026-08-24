// 즉시출고 재고 → 구글 스프레드시트 동기화.
// 서비스 계정 JWT를 Node 내장 crypto로 직접 서명해 Sheets REST API를 호출한다
// (googleapis 의존성 없이 동작). 브랜드별 탭에 최신 스냅샷을 통째로 덮어쓴다.
import { createSign } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { ImmediateDeliveryBrand } from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export const SHEET_HEADER = [
  "모델",
  "재고구분",
  "트림",
  "판매코드",
  "옵션",
  "외장색",
  "내장색",
  "가격",
  "판매조건",
  "수량",
  "출고지",
] as const;

const STOCK_TYPE_LABEL: Record<string, string> = { NORMAL: "정상", LIMITED: "한정/조건" };

// 탭 구성: 출고 채널별 접두사로 그룹화한다.
// 대리점 출고 = 브랜드별 탭, 금융사 출고 = 자리 탭(스크래퍼 연동 시 금융사별 탭으로 확장 예정).
export const FINANCE_TAB_TITLE = "금융사출고";
const DEFAULT_EMPTY_TAB = "시트1"; // 스프레드시트 생성 시 딸려오는 빈 기본 탭 — 발견하면 제거

export function dealerTabTitle(brand: ImmediateDeliveryBrand): string {
  return `대리점출고-${brand}`;
}

interface SheetConfig {
  clientEmail: string;
  privateKey: string;
  sheetId: string;
}

/** 환경변수 3종이 모두 있어야 동기화가 켜진다. 빈 문자열 placeholder는 미설정으로 취급. */
export function sheetSyncConfig(): SheetConfig | null {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  // Vercel env 입력 시 개행이 "\n" 리터럴로 저장되는 경우를 복원한다.
  const privateKey = process.env.GOOGLE_SHEETS_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const sheetId = process.env.IMMEDIATE_DELIVERY_SHEET_ID;
  if (!clientEmail || !privateKey || !sheetId) return null;
  return { clientEmail, privateKey, sheetId };
}

export function immediateDeliverySheetUrl(): string | null {
  const sheetId = process.env.IMMEDIATE_DELIVERY_SHEET_ID;
  return sheetId ? `https://docs.google.com/spreadsheets/d/${sheetId}` : null;
}

function fmtSeoul(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(d);
}

export interface SheetBatchInfo {
  fileName: string;
  snapshotDate: string | null;
  rowCount: number;
  vehicleCount: number;
  uploadedAt: Date;
  syncedAt: Date;
}

export interface SheetStockRow {
  model: string;
  stockType: string;
  trimName: string;
  salesCode: string | null;
  optionText: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  price: number | null;
  discount: number | null;
  quantity: number;
  location: string | null;
}

/** 탭에 쓸 2차원 값 배열. 1행=출처 정보, 2행=헤더, 3행부터 데이터. */
export function buildSheetValues(info: SheetBatchInfo, rows: SheetStockRow[]): (string | number)[][] {
  const infoLine =
    `${info.fileName}` +
    (info.snapshotDate ? ` · 기준일 ${info.snapshotDate}` : "") +
    ` · 업로드 ${fmtSeoul(info.uploadedAt)} · 동기화 ${fmtSeoul(info.syncedAt)}` +
    ` · ${info.rowCount.toLocaleString("ko-KR")}행 ${info.vehicleCount.toLocaleString("ko-KR")}대`;
  return [
    [infoLine],
    [...SHEET_HEADER],
    ...rows.map((r) => [
      r.model,
      STOCK_TYPE_LABEL[r.stockType] ?? r.stockType,
      r.trimName,
      r.salesCode ?? "",
      r.optionText ?? "",
      r.exteriorColor ?? "",
      r.interiorColor ?? "",
      r.price ?? "",
      r.discount ?? "",
      r.quantity,
      r.location ?? "",
    ]),
  ];
}

/** 서비스 계정 JWT 조립(RS256). 테스트를 위해 분리. */
export function buildServiceAccountJwt(cfg: Pick<SheetConfig, "clientEmail" | "privateKey">, nowSec: number): string {
  const b64url = (s: string) => Buffer.from(s).toString("base64url");
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iss: cfg.clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(cfg.privateKey).toString("base64url")}`;
}

async function getAccessToken(cfg: SheetConfig): Promise<string> {
  const assertion = buildServiceAccountJwt(cfg, Math.floor(Date.now() / 1000));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`구글 서비스 계정 인증 실패(${res.status}): ${data.error_description ?? data.error ?? "unknown"}`);
  }
  return data.access_token;
}

async function sheetsApi<T>(token: string, sheetId: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init?.headers },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(`구글 시트 API 오류(${res.status}): ${data.error?.message ?? "unknown"}`);
  }
  return data;
}

/**
 * 브랜드 동기화에 앞서 탭 구조를 정돈한다.
 * - 대리점 탭이 없으면 생성(구 브랜드명 탭이 있으면 이름 변경으로 마이그레이션), 있으면 그리드 조정
 * - 금융사출고 자리 탭이 없으면 생성 (생성 시 true 반환 → 호출자가 안내 문구를 채운다)
 * - 기본 빈 탭(시트1)이 남아 있으면 삭제
 */
async function ensureTabs(
  token: string,
  sheetId: string,
  brand: ImmediateDeliveryBrand,
  rowCount: number,
  columnCount: number,
): Promise<{ financeTabCreated: boolean }> {
  const meta = await sheetsApi<{ sheets?: { properties: { sheetId: number; title: string } }[] }>(
    token,
    sheetId,
    "?fields=sheets.properties(sheetId,title)",
  );
  const byTitle = (t: string) => meta.sheets?.find((s) => s.properties.title === t);
  const requests: unknown[] = [];

  const title = dealerTabTitle(brand);
  const gridProperties = { rowCount: Math.max(rowCount + 5, 50), columnCount };
  // 채널 분리 이전에는 탭명이 브랜드명 그대로였다 — 있으면 새 이름으로 바꿔 재사용
  const existing = byTitle(title) ?? byTitle(brand);
  if (existing) {
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: existing.properties.sheetId, title, gridProperties },
        fields: "title,gridProperties(rowCount,columnCount)",
      },
    });
  } else {
    requests.push({ addSheet: { properties: { title, gridProperties } } });
  }

  const financeTabCreated = !byTitle(FINANCE_TAB_TITLE);
  if (financeTabCreated) {
    requests.push({
      addSheet: { properties: { title: FINANCE_TAB_TITLE, gridProperties: { rowCount: 50, columnCount } } },
    });
  }

  const emptyTab = byTitle(DEFAULT_EMPTY_TAB);
  if (emptyTab) requests.push({ deleteSheet: { sheetId: emptyTab.properties.sheetId } });

  await sheetsApi(token, sheetId, ":batchUpdate", { method: "POST", body: JSON.stringify({ requests }) });
  return { financeTabCreated };
}

export type SheetSyncResult =
  | { status: "ok" }
  | { status: "disabled" }
  | { status: "failed"; error: string };

/**
 * 업로드/삭제 후 호출하는 실패 무해화 래퍼 — 시트 동기화 실패가 DB 반영을
 * 되돌리지 않도록 결과 객체로만 알린다. 환경변수 미설정 시 disabled.
 */
export async function attemptBrandSheetSync(brand: ImmediateDeliveryBrand): Promise<SheetSyncResult> {
  if (!sheetSyncConfig()) return { status: "disabled" };
  try {
    await syncBrandSheet(brand);
    return { status: "ok" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[immediate-delivery sheet-sync] ${brand} 실패:`, msg);
    return { status: "failed", error: msg };
  }
}

/**
 * 해당 브랜드의 최신 스냅샷을 브랜드명 탭에 덮어쓴다. 데이터가 없으면(삭제 후)
 * "데이터 없음" 안내만 남긴다. 실패 시 throw — 호출자가 잡아서 경고 처리한다.
 */
export async function syncBrandSheet(brand: ImmediateDeliveryBrand): Promise<void> {
  const cfg = sheetSyncConfig();
  if (!cfg) throw new Error("구글 시트 동기화 환경변수가 설정되지 않았습니다.");

  const batch = await prisma.immediateDeliveryBatch.findFirst({
    where: { brand },
    orderBy: { createdAt: "desc" },
  });

  let values: (string | number)[][];
  if (!batch) {
    values = [[`데이터 없음 — ${fmtSeoul(new Date())} 기준`]];
  } else {
    const rows = await prisma.immediateDeliveryStock.findMany({
      where: { batchId: batch.id },
      orderBy: [{ model: "asc" }, { stockType: "asc" }, { trimName: "asc" }],
      select: {
        model: true,
        stockType: true,
        trimName: true,
        salesCode: true,
        optionText: true,
        exteriorColor: true,
        interiorColor: true,
        price: true,
        discount: true,
        quantity: true,
        location: true,
      },
    });
    const meta = (batch.warnings ?? {}) as { snapshotDate?: string };
    values = buildSheetValues(
      {
        fileName: batch.fileName,
        snapshotDate: meta.snapshotDate ?? null,
        rowCount: batch.rowCount,
        vehicleCount: batch.vehicleCount,
        uploadedAt: batch.createdAt,
        syncedAt: new Date(),
      },
      rows,
    );
  }

  const token = await getAccessToken(cfg);
  const { financeTabCreated } = await ensureTabs(token, cfg.sheetId, brand, values.length, SHEET_HEADER.length);
  const title = dealerTabTitle(brand);
  await sheetsApi(token, cfg.sheetId, `/values/${encodeURIComponent(`'${title}'`)}:clear`, { method: "POST", body: "{}" });
  await sheetsApi(token, cfg.sheetId, `/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  if (financeTabCreated) {
    // 자리 탭 안내 문구는 최초 생성 시에만 쓴다 — 이후 수동 편집을 덮어쓰지 않는다.
    await sheetsApi(token, cfg.sheetId, `/values/${encodeURIComponent(`'${FINANCE_TAB_TITLE}'!A1`)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [["금융사 출고 재고 — 준비 중 (스크래퍼 연동 시 금융사별 탭으로 제공 예정)"]] }),
    });
  }
}

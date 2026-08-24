"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
// index.ts는 xlsx를 끌고 오므로 클라이언트에서는 types만 import한다.
import { IMMEDIATE_DELIVERY_BRANDS } from "@/lib/immediate-delivery/types";
import type { BrandSnapshot, ModelSummary } from "./page";

interface PreviewSummary {
  brand: string;
  rowCount: number;
  vehicleCount: number;
  models: ModelSummary[];
  warnings: string[];
  skippedSheets: string[];
}

interface StockRowDetail {
  id: string;
  stockType: string;
  salesCode: string | null;
  trimName: string;
  optionText: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  price: number | null;
  discount: number | null;
  quantity: number;
  location: string | null;
}

const STOCK_TYPE_LABEL: Record<string, string> = { NORMAL: "정상", LIMITED: "한정/조건" };

// 출고 채널: 대리점(엑셀 업로드) | 금융사(추후 스크래퍼 연동 예정)
const CHANNELS = [
  { key: "dealer", label: "대리점 출고" },
  { key: "finance", label: "금융사 출고" },
] as const;
type ChannelKey = (typeof CHANNELS)[number]["key"];

function fmtNum(n: number | null | undefined): string {
  return n == null ? "-" : n.toLocaleString("ko-KR");
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export function ImmediateDeliveryClient({
  snapshots,
  sheetUrl,
  sheetSyncEnabled,
}: {
  snapshots: BrandSnapshot[];
  sheetUrl: string | null;
  sheetSyncEnabled: boolean;
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelKey>("dealer");
  const [activeBrand, setActiveBrand] = useState<string>(
    snapshots[0]?.brand ?? IMMEDIATE_DELIVERY_BRANDS[0],
  );

  const snapshot = snapshots.find((s) => s.brand === activeBrand) ?? null;

  return (
    <div className="min-h-full bg-[#F8F9FC] p-6">
      <div className="mx-auto max-w-6xl flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#1A1F36]">즉시출고 재고</h1>
            <p className="mt-1 text-sm text-[#9BA4C0]">
              즉시출고 차량을 출고 채널(대리점/금융사)별로 관리합니다.
            </p>
          </div>
          {channel === "dealer" && <SheetPanel sheetUrl={sheetUrl} syncEnabled={sheetSyncEnabled} />}
        </div>

        <div className="flex gap-1 rounded-xl bg-[#E8EAF0] p-1 self-start">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChannel(c.key)}
              className={`rounded-lg px-5 py-2 text-sm font-bold transition-colors ${
                channel === c.key
                  ? "bg-white text-[#3A41C8] shadow-sm"
                  : "text-[#5A6080] hover:text-[#3A41C8]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {channel === "finance" ? (
          <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-10 text-center">
            <p className="text-sm font-bold text-[#5A6080]">금융사 출고 재고는 준비 중입니다.</p>
            <p className="mt-1.5 text-xs text-[#9BA4C0]">
              금융사 재고 스크래퍼 연동과 함께 제공될 예정입니다. 대리점 출고 재고는 &quot;대리점 출고&quot; 탭에서 관리하세요.
            </p>
          </div>
        ) : (
          <>
            <UploadPanel onApplied={(brand) => { setActiveBrand(brand); router.refresh(); }} />

            <div className="flex gap-2">
              {IMMEDIATE_DELIVERY_BRANDS.map((brand) => {
                const s = snapshots.find((x) => x.brand === brand);
                const active = brand === activeBrand;
                return (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => setActiveBrand(brand)}
                    className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
                      active
                        ? "bg-[#6066EE] text-white"
                        : "bg-white text-[#5A6080] border border-[#E8EAF0] hover:bg-[#EEF0FF]"
                    }`}
                  >
                    {brand}
                    <span className={`ml-1.5 text-xs ${active ? "text-white/80" : "text-[#9BA4C0]"}`}>
                      {s ? `${s.vehicleCount.toLocaleString("ko-KR")}대` : "없음"}
                    </span>
                  </button>
                );
              })}
            </div>

            {snapshot ? (
              <BrandPanel snapshot={snapshot} onDeleted={() => router.refresh()} />
            ) : (
              <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-10 text-center text-sm text-[#9BA4C0]">
                {activeBrand} 재고 데이터가 없습니다. 위에서 재고리스트 엑셀을 업로드하세요.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface SheetSyncResult {
  status: "ok" | "disabled" | "failed";
  error?: string;
}

/** 구글 시트 링크 + 수동 동기화 버튼. */
function SheetPanel({ sheetUrl, syncEnabled }: { sheetUrl: string | null; syncEnabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const syncAll = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/immediate-delivery/sheet-sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "동기화 실패");
      const failed = Object.entries(data.results as Record<string, SheetSyncResult>)
        .filter(([, r]) => r.status === "failed")
        .map(([brand, r]) => `${brand}: ${r.error}`);
      setMessage(
        failed.length === 0
          ? { ok: true, text: "구글 시트 동기화 완료" }
          : { ok: false, text: `일부 실패 — ${failed.join(" / ")}` },
      );
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!sheetUrl && !syncEnabled) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {sheetUrl && (
          <a
            href={sheetUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#E8EAF0] bg-white px-3 py-1.5 text-xs font-bold text-[#3A41C8] hover:bg-[#EEF0FF] transition-colors"
          >
            구글 시트 열기 ↗
          </a>
        )}
        {syncEnabled && (
          <button
            type="button"
            onClick={syncAll}
            disabled={busy}
            className="rounded-lg bg-[#6066EE] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#4F55DB] transition-colors"
          >
            {busy ? "동기화 중…" : "시트 동기화"}
          </button>
        )}
      </div>
      {message && (
        <p className={`text-xs ${message.ok ? "text-green-600" : "text-red-500"}`}>{message.text}</p>
      )}
    </div>
  );
}

/** 엑셀 업로드: 미리보기(파싱 요약 확인) → 반영(스냅샷 교체) 2단계. */
function UploadPanel({ onApplied }: { onApplied: (brand: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [preview, setPreview] = useState<{ summary: PreviewSummary; snapshotDate: string | null } | null>(null);
  const [applied, setApplied] = useState<{ summary: PreviewSummary; sheetSync: SheetSyncResult | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPreview(null); setApplied(null); setError(null); };

  const submit = async (mode: "preview" | "apply") => {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (mode === "preview") fd.append("mode", "preview");
      const res = await fetch("/api/admin/immediate-delivery/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업로드 실패");
      if (mode === "preview") {
        setPreview({ summary: data.summary, snapshotDate: data.snapshotDate ?? null });
      } else {
        setApplied({ summary: data.summary, sheetSync: data.sheetSync ?? null });
        setPreview(null);
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        onApplied(data.summary.brand);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-5">
      <h3 className="text-sm font-bold text-[#3A41C8] mb-1">재고리스트 업로드</h3>
      <p className="text-xs text-[#9BA4C0] mb-4">
        기아/현대/르노 재고리스트(.xls/.xlsx)를 업로드하세요. 브랜드는 자동 감지되며,
        <b> 반영 시 해당 브랜드의 기존 데이터는 새 스냅샷으로 전체 교체</b>됩니다.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); reset(); }}
          className="text-sm text-[#5A6080] file:mr-3 file:rounded-lg file:border-0 file:bg-[#EEF0FF] file:px-3 file:py-2 file:text-xs file:font-bold file:text-[#3A41C8] hover:file:bg-[#E2E5FF]"
        />
        <button
          type="button"
          onClick={() => submit("preview")}
          disabled={!file || busy !== null}
          className="rounded-lg bg-white border border-[#6066EE] px-4 py-2 text-xs font-bold text-[#3A41C8] disabled:opacity-40 hover:bg-[#EEF0FF] transition-colors"
        >
          {busy === "preview" ? "파싱 중…" : "미리보기"}
        </button>
        <button
          type="button"
          onClick={() => submit("apply")}
          disabled={!file || busy !== null || !preview}
          title={preview ? undefined : "미리보기로 파싱 결과를 확인한 뒤 반영할 수 있습니다."}
          className="rounded-lg bg-[#6066EE] px-4 py-2 text-xs font-bold text-white disabled:opacity-40 hover:bg-[#4F55DB] transition-colors"
        >
          {busy === "apply" ? "반영 중…" : "반영하기"}
        </button>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</div>}

      {preview && (
        <div className="mt-4 rounded-xl border border-[#E8EAF0] bg-[#F8F9FC] p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-[#6066EE] px-2 py-0.5 text-xs font-bold text-white">{preview.summary.brand}</span>
            <span className="font-bold text-[#1A1F36]">
              {preview.summary.models.length}개 모델그룹 · {preview.summary.rowCount.toLocaleString("ko-KR")}행 ·{" "}
              {preview.summary.vehicleCount.toLocaleString("ko-KR")}대
            </span>
            {preview.snapshotDate && <span className="text-xs text-[#9BA4C0]">기준일 {preview.snapshotDate}</span>}
          </div>
          <WarningList warnings={preview.summary.warnings} skippedSheets={preview.summary.skippedSheets} />
          <p className="mt-2 text-xs text-[#9BA4C0]">
            내용 확인 후 <b className="text-[#3A41C8]">반영하기</b>를 누르면 {preview.summary.brand} 재고가 이 파일 기준으로 교체됩니다.
          </p>
        </div>
      )}

      {applied && (
        <div className="mt-4 flex flex-col gap-2">
          <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
            {applied.summary.brand} 재고 반영 완료 — {applied.summary.rowCount.toLocaleString("ko-KR")}행 ·{" "}
            {applied.summary.vehicleCount.toLocaleString("ko-KR")}대
            {applied.sheetSync?.status === "ok" && " · 구글 시트 동기화 완료"}
          </div>
          {applied.sheetSync?.status === "failed" && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
              구글 시트 동기화 실패: {applied.sheetSync.error} — 상단 &quot;시트 동기화&quot; 버튼으로 재시도할 수 있습니다.
              (DB 반영은 완료된 상태입니다)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WarningList({ warnings, skippedSheets }: { warnings: string[]; skippedSheets: string[] }) {
  if (warnings.length === 0 && skippedSheets.length === 0) return null;
  return (
    <div className="mt-2 flex flex-col gap-1">
      {skippedSheets.length > 0 && (
        <p className="text-xs text-[#9BA4C0]">제외된 시트({skippedSheets.length}): {skippedSheets.join(", ")}</p>
      )}
      {warnings.length > 0 && (
        <details className="text-xs text-amber-600">
          <summary className="cursor-pointer font-bold">경고 {warnings.length}건</summary>
          <ul className="mt-1 list-disc pl-4">
            {warnings.slice(0, 30).map((w, i) => <li key={i}>{w}</li>)}
            {warnings.length > 30 && <li>… 외 {warnings.length - 30}건</li>}
          </ul>
        </details>
      )}
    </div>
  );
}

/** 브랜드 탭 내용: 최근 업로드 정보 + 모델 목록(펼치면 행 상세). */
function BrandPanel({ snapshot, onDeleted }: { snapshot: BrandSnapshot; onDeleted: () => void }) {
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return snapshot.models;
    return snapshot.models.filter((m) => m.model.toLowerCase().includes(q));
  }, [snapshot.models, search]);

  const removeBrand = async () => {
    if (!window.confirm(`${snapshot.brand} 즉시출고 재고 데이터를 전부 삭제할까요?\n(업로드된 스냅샷이 제거되며 되돌릴 수 없습니다)`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/immediate-delivery?brand=${encodeURIComponent(snapshot.brand)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제 실패");
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-[#3A41C8]">{snapshot.brand} 최신 스냅샷</h3>
          <p className="mt-1 text-xs text-[#9BA4C0]">
            {snapshot.fileName}
            {snapshot.snapshotDate && <> · 기준일 <b className="text-[#5A6080]">{snapshot.snapshotDate}</b></>}
            {" · 업로드 "}{fmtDateTime(snapshot.uploadedAt)}
          </p>
          <p className="mt-0.5 text-xs text-[#9BA4C0]">
            총 <b className="text-[#3A41C8]">{snapshot.rowCount.toLocaleString("ko-KR")}행</b> ·{" "}
            <b className="text-[#3A41C8]">{snapshot.vehicleCount.toLocaleString("ko-KR")}대</b>
          </p>
          <WarningList warnings={snapshot.warnings} skippedSheets={snapshot.skippedSheets} />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="모델 검색"
            className="rounded-lg border border-[#E8EAF0] px-3 py-1.5 text-xs text-[#1A1F36] placeholder:text-[#9BA4C0] focus:outline-none focus:border-[#6066EE]"
          />
          <button
            type="button"
            onClick={removeBrand}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-500 disabled:opacity-40 hover:bg-red-50 transition-colors"
          >
            {deleting ? "삭제 중…" : "브랜드 데이터 삭제"}
          </button>
        </div>
      </div>

      {error && <div className="mt-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</div>}

      <div className="mt-4 flex flex-col gap-2">
        {filtered.length === 0 && (
          <p className="py-6 text-center text-sm text-[#9BA4C0]">검색 결과가 없습니다.</p>
        )}
        {filtered.map((m) => (
          <ModelRow key={`${m.model}-${m.stockType}`} brand={snapshot.brand} summary={m} />
        ))}
      </div>
    </div>
  );
}

/** 모델×재고구분 1줄. 펼치면 행 상세를 API로 가져와 표로 보여준다. */
function ModelRow({ brand, summary }: { brand: string; summary: ModelSummary }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<StockRowDetail[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || rows !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ brand, model: summary.model, stockType: summary.stockType });
      const res = await fetch(`/api/admin/immediate-delivery?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "조회 실패");
      setRows(data.rows);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const limited = summary.stockType === "LIMITED";

  return (
    <div className="rounded-xl border border-[#E8EAF0]">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[#F8F9FC] transition-colors rounded-xl"
      >
        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${
          limited ? "bg-amber-50 text-amber-600 border border-amber-200" : "bg-[#EEF0FF] text-[#3A41C8]"
        }`}>
          {STOCK_TYPE_LABEL[summary.stockType] ?? summary.stockType}
        </span>
        <span className="text-sm font-bold text-[#1A1F36]">{summary.model}</span>
        <span className="ml-auto text-xs text-[#9BA4C0]">
          {summary.rows.toLocaleString("ko-KR")}행 · <b className="text-[#5A6080]">{summary.quantity.toLocaleString("ko-KR")}대</b>
        </span>
        <span className="text-xs text-[#9BA4C0]">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-[#E8EAF0] px-4 py-3">
          {loading && <p className="py-4 text-center text-xs text-[#9BA4C0]">불러오는 중…</p>}
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-600">{error}</div>}
          {rows && <DetailTable rows={rows} limited={limited} />}
        </div>
      )}
    </div>
  );
}

function DetailTable({ rows, limited }: { rows: StockRowDetail[]; limited: boolean }) {
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-[#9BA4C0]">재고 행이 없습니다.</p>;
  const hasPrice = rows.some((r) => r.price != null);
  const hasDiscount = rows.some((r) => r.discount != null);
  const hasLocation = rows.some((r) => r.location);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[#E8EAF0] text-left text-[#9BA4C0]">
            <th className="py-2 pr-3 font-medium">트림</th>
            <th className="py-2 pr-3 font-medium">옵션</th>
            <th className="py-2 pr-3 font-medium">외장</th>
            <th className="py-2 pr-3 font-medium">내장</th>
            {hasPrice && <th className="py-2 pr-3 font-medium text-right">가격</th>}
            {hasDiscount && <th className="py-2 pr-3 font-medium text-right">{limited ? "판매조건" : "할인"}</th>}
            <th className="py-2 pr-3 font-medium text-right">수량</th>
            {hasLocation && <th className="py-2 font-medium">출고지</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-[#F1F3F9] text-[#1A1F36]">
              <td className="py-1.5 pr-3">
                {r.trimName}
                {r.salesCode && <span className="ml-1 text-[#9BA4C0]">({r.salesCode})</span>}
              </td>
              <td className="py-1.5 pr-3 text-[#5A6080]">{r.optionText || "-"}</td>
              <td className="py-1.5 pr-3 text-[#5A6080]">{r.exteriorColor || "-"}</td>
              <td className="py-1.5 pr-3 text-[#5A6080]">{r.interiorColor || "-"}</td>
              {hasPrice && <td className="py-1.5 pr-3 text-right">{fmtNum(r.price)}</td>}
              {hasDiscount && <td className="py-1.5 pr-3 text-right text-amber-600">{fmtNum(r.discount)}</td>}
              <td className="py-1.5 pr-3 text-right font-bold">{r.quantity.toLocaleString("ko-KR")}</td>
              {hasLocation && <td className="py-1.5 text-[#5A6080]">{r.location || "-"}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

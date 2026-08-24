"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface VehicleLite {
  id: string;
  brand: string;
  name: string;
}
interface Props {
  financeCompanyId: string;
  productType: string;
  vehicles: VehicleLite[];
}

interface CatalogTrimLite {
  id: string;
  brandName?: string;
  modelName?: string;
  trimName: string;
  modelYear: string | null;
  vehiclePrice: number;
}
interface MappingRow {
  trimId: string;
  trimName: string;
  price: number;
  mapping: {
    id: string;
    source: string;
    confidence: string | null;
    externalLabel: string;
    catalogTrim: CatalogTrimLite;
    newerYearAvailable: boolean;
  } | null;
}
interface Suggestion {
  catalogTrimId: string;
  label: string;
  vehiclePrice: number;
  confidence: "exact" | "fuzzy";
}
interface TrimStatus {
  trimId: string;
  label: string;
  ok: boolean;
  reason?: string;
}
interface VehicleSummary {
  total: number;
  mapped: number;
}

function weekOfMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().slice(0, 10);
}

/** 우리 트림 ↔ 카탈로그 매핑 + 정확값 시트 반영. 차량 여러 대를 골라 한 번에 작업할 수 있다. */
export default function CatalogMappingPanel({ financeCompanyId, productType, vehicles }: Props) {
  // ① 브랜드 → ② 차량 칩(다중 선택) — 수집 화면과 같은 단계형
  const [brand, setBrand] = useState("");
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // 차량 칩에 표시할 매핑 현황 (브랜드 단위 집계)
  const [summary, setSummary] = useState<Record<string, VehicleSummary>>({});

  const [rowsByVehicle, setRowsByVehicle] = useState<Record<string, MappingRow[]>>({});
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion | null>>({});
  const [suggestWarning, setSuggestWarning] = useState<string | null>(null);
  // 마지막 동작(제안·채택·해제)의 결과 알림 — 모든 버튼이 완료/실패를 말하게 한다
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // 수동 검색 (트림 행 단위)
  const [searchRow, setSearchRow] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<CatalogTrimLite[]>([]);
  // 반영 전 미리보기(dry-run) — 트림별 반영 가능/사유
  const [precheck, setPrecheck] = useState<Record<string, TrimStatus>>({});
  // 반영
  const [applySel, setApplySel] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [applyDetails, setApplyDetails] = useState<TrimStatus[]>([]);

  const vehicleById = useMemo(() => new Map(vehicles.map((v) => [v.id, v] as const)), [vehicles]);
  const brands = useMemo(
    () => Array.from(new Set(vehicles.map((v) => v.brand))).sort((a, b) => a.localeCompare(b, "ko")),
    [vehicles]
  );
  const brandVehicles = useMemo(() => {
    const q = vehicleQuery.trim().toLowerCase();
    return vehicles
      .filter((v) => v.brand === brand)
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [vehicles, brand, vehicleQuery]);
  const selectedVehicles = useMemo(
    () => selectedIds.map((id) => vehicleById.get(id)).filter((v): v is VehicleLite => !!v),
    [selectedIds, vehicleById]
  );

  const loadSummary = useCallback(
    async (b: string) => {
      if (!b) return;
      try {
        const d = await (
          await fetch(
            `/api/admin/capital-catalog/mappings?financeCompanyId=${financeCompanyId}&summaryBrand=${encodeURIComponent(b)}&productType=${encodeURIComponent(productType)}`
          )
        ).json();
        const map: Record<string, VehicleSummary> = {};
        for (const s of d.summary ?? []) map[s.vehicleId] = { total: s.total, mapped: s.mapped };
        setSummary(map);
      } catch {
        setSummary({});
      }
    },
    [financeCompanyId, productType]
  );

  useEffect(() => {
    setSummary({});
    if (brand) void loadSummary(brand);
  }, [brand, loadSummary]);

  // 매핑된 트림들의 반영 가능 여부를 서버 기준으로 미리 확인한다 (쓰기 없음)
  const runPrecheck = useCallback(
    async (all: Record<string, MappingRow[]>) => {
      const mappedIds = Object.values(all).flat().filter((r) => r.mapping).map((r) => r.trimId);
      if (mappedIds.length === 0) {
        setPrecheck({});
        return;
      }
      try {
        const d = await (
          await fetch("/api/admin/capital-rates/apply-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ financeCompanyId, productType, weekOf: weekOfMonday(), trimIds: mappedIds, dryRun: true }),
          })
        ).json();
        const map: Record<string, TrimStatus> = {};
        for (const s of d.statuses ?? []) map[s.trimId] = s;
        setPrecheck(map);
        // 반영 불가 트림은 선택에서 미리 제외해, 버튼 숫자와 실제 반영 수가 어긋나지 않게 한다
        setApplySel((prev) => new Set(Array.from(prev).filter((id) => map[id]?.ok !== false)));
      } catch {
        setPrecheck({});
      }
    },
    [financeCompanyId, productType]
  );

  const suggestFor = useCallback(
    async (vehicleIds: string[]) => {
      if (vehicleIds.length === 0) return;
      setSuggesting(true);
      setSuggestWarning(null);
      try {
        const warns: string[] = [];
        const merged: Record<string, Suggestion | null> = {};
        for (const vid of vehicleIds) {
          const d = await (
            await fetch("/api/admin/capital-catalog/mappings/suggest", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ financeCompanyId, vehicleId: vid, productType }),
            })
          ).json();
          if (d.warning) warns.push(`${vehicleById.get(vid)?.name ?? vid}: ${d.warning}`);
          for (const s of d.suggestions ?? []) merged[s.trimId] = s.suggestion;
        }
        if (warns.length) setSuggestWarning(warns.join(" · "));
        setSuggestions((prev) => ({ ...prev, ...merged }));
        const found = Object.values(merged).filter(Boolean).length;
        setNotice(
          found > 0
            ? { ok: true, text: `자동 매핑 분석 완료 — 제안 ${found}건. 각 행의 [채택] 또는 [제안 전체 채택]을 누르세요.` }
            : { ok: true, text: "자동 매핑 분석 완료 — 새로 제안할 항목이 없습니다." }
        );
      } catch {
        setNotice({ ok: false, text: "자동 매핑 분석에 실패했습니다. 잠시 후 다시 시도하세요." });
      } finally {
        setSuggesting(false);
      }
    },
    [financeCompanyId, productType, vehicleById]
  );

  // 차량들의 트림·매핑을 (재)조회 — 조회 후 선택 세트·미리보기 갱신, 필요 시 자동 제안
  const loadVehicles = useCallback(
    async (vehicleIds: string[], opts?: { autoSuggest?: boolean }) => {
      if (vehicleIds.length === 0) return;
      // 결과 메시지는 여기서 지우지 않는다 — 반영 직후 리로드가 ✅/❌ 표시를 삼키지 않게.
      // (반영 결과 초기화는 apply() 시작 시점과 차량 선택 변경 시점에만 한다)
      setLoadingIds((prev) => new Set([...prev, ...vehicleIds]));
      try {
        const fetched = await Promise.all(
          vehicleIds.map(async (vid) => {
            const d = await (
              await fetch(
                `/api/admin/capital-catalog/mappings?financeCompanyId=${financeCompanyId}&vehicleId=${vid}&productType=${encodeURIComponent(productType)}`
              )
            ).json();
            return [vid, (d.trims ?? []) as MappingRow[]] as const;
          })
        );
        setRowsByVehicle((prev) => {
          const next = { ...prev };
          for (const [vid, rs] of fetched) next[vid] = rs;
          return next;
        });
        // 새로 조회된 차량의 매핑 트림을 선택 세트에 추가 (기존 선택은 유지)
        setApplySel((prev) => {
          const s = new Set(prev);
          for (const [, rs] of fetched) for (const r of rs) if (r.mapping) s.add(r.trimId);
          return s;
        });
        if (opts?.autoSuggest) {
          const needSuggest = fetched.filter(([, rs]) => rs.some((r) => !r.mapping)).map(([vid]) => vid);
          if (needSuggest.length) void suggestFor(needSuggest);
        }
      } finally {
        setLoadingIds((prev) => {
          const s = new Set(prev);
          for (const vid of vehicleIds) s.delete(vid);
          return s;
        });
      }
    },
    [financeCompanyId, productType, suggestFor]
  );

  // 트림·매핑이 바뀔 때마다 반영 가능 여부를 다시 확인한다 (조회·채택·해제·반영 공통)
  useEffect(() => {
    void runPrecheck(rowsByVehicle);
  }, [rowsByVehicle, runPrecheck]);

  const toggleVehicle = (vid: string) => {
    setApplyResult(null);
    setApplyDetails([]);
    if (selectedIds.includes(vid)) {
      // 해제 — 이 차량의 행·선택·제안 정리
      const rows = rowsByVehicle[vid] ?? [];
      const trimIds = new Set(rows.map((r) => r.trimId));
      setSelectedIds((prev) => prev.filter((id) => id !== vid));
      setRowsByVehicle((prev) => {
        const next = { ...prev };
        delete next[vid];
        return next;
      });
      setApplySel((prev) => new Set(Array.from(prev).filter((id) => !trimIds.has(id))));
      setSuggestions((prev) => {
        const next = { ...prev };
        for (const id of trimIds) delete next[id];
        return next;
      });
    } else {
      setSelectedIds((prev) => [...prev, vid]);
      void loadVehicles([vid], { autoSuggest: true });
    }
  };

  const saveMapping = async (vehicleId: string, trimId: string, catalogTrimId: string, source: "auto" | "manual", confidence?: string) => {
    try {
      const res = await fetch("/api/admin/capital-catalog/mappings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financeCompanyId, trimId, productType, catalogTrimId, source, confidence: confidence ?? null }),
      });
      if (res.ok) {
        setSuggestions((prev) => ({ ...prev, [trimId]: null }));
        setNotice({ ok: true, text: "매핑 저장 완료" });
        await loadVehicles([vehicleId]);
        void loadSummary(brand);
      } else {
        const d = await res.json().catch(() => ({}));
        setNotice({ ok: false, text: `매핑 저장 실패${d.error ? ` — ${d.error}` : ""}` });
      }
    } catch {
      setNotice({ ok: false, text: "매핑 저장 실패 — 네트워크 오류" });
    }
  };

  const adoptAll = async () => {
    setAdopting(true);
    try {
      // 저장은 순차, 리로드는 마지막에 한 번만 — 트림 수만큼 화면이 깜빡이지 않게
      let okCount = 0;
      let failCount = 0;
      for (const [trimId, s] of Object.entries(suggestions)) {
        if (!s) continue;
        try {
          const res = await fetch("/api/admin/capital-catalog/mappings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ financeCompanyId, trimId, productType, catalogTrimId: s.catalogTrimId, source: "auto", confidence: s.confidence }),
          });
          if (res.ok) okCount += 1;
          else failCount += 1;
        } catch {
          failCount += 1;
        }
      }
      setSuggestions({});
      setNotice(
        failCount === 0
          ? { ok: true, text: `제안 ${okCount}건 채택 완료` }
          : { ok: false, text: `제안 ${okCount}건 채택, ${failCount}건 실패 — [자동 매핑 제안]으로 다시 시도하세요` }
      );
      await loadVehicles(selectedIds);
      void loadSummary(brand);
    } finally {
      setAdopting(false);
    }
  };

  const removeMapping = async (vehicleId: string, mappingId: string) => {
    try {
      const res = await fetch(`/api/admin/capital-catalog/mappings?id=${mappingId}`, { method: "DELETE" });
      setNotice(res.ok ? { ok: true, text: "매핑 해제 완료" } : { ok: false, text: "매핑 해제 실패" });
    } catch {
      setNotice({ ok: false, text: "매핑 해제 실패 — 네트워크 오류" });
    }
    await loadVehicles([vehicleId]);
    void loadSummary(brand);
  };

  const runSearch = async (q: string) => {
    setSearchQ(q);
    if (q.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const d = await (
      await fetch(
        `/api/admin/capital-catalog?financeCompanyId=${financeCompanyId}&productType=${encodeURIComponent(productType)}&q=${encodeURIComponent(q)}`
      )
    ).json();
    setSearchResults(d.trims ?? []);
  };

  const apply = async () => {
    const trimIds = Array.from(applySel);
    if (trimIds.length === 0) return;
    setApplying(true);
    setApplyResult(null);
    setApplyDetails([]);
    try {
      const res = await fetch("/api/admin/capital-rates/apply-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financeCompanyId, productType, weekOf: weekOfMonday(), trimIds }),
      });
      const d = await res.json().catch(() => ({}));
      const skipped: TrimStatus[] = (d.statuses ?? []).filter((s: TrimStatus) => !s.ok);
      setApplyDetails(skipped);
      if (!res.ok) setApplyResult(`❌ ${d.error ?? "반영 실패"}`);
      else
        setApplyResult(
          `✅ 트림 ${d.applied}개 정확값 시트 반영 완료${skipped.length ? ` · 건너뜀 ${skipped.length}건` : ""} — 회수율 데이터 관리 탭에서 확인 가능`
        );
      void loadVehicles(selectedIds);
    } catch {
      // 시간 초과·네트워크 단절 — 조용히 사라지지 않게 반드시 알린다
      setApplyResult("❌ 반영 요청이 완료되지 못했습니다(시간 초과 또는 네트워크 오류). 잠시 후 다시 시도하거나, 트림을 나눠서 반영해 보세요.");
    } finally {
      setApplying(false);
    }
  };

  const hasSuggestions = Object.values(suggestions).some(Boolean);
  const allRows = useMemo(() => Object.values(rowsByVehicle).flat(), [rowsByVehicle]);
  const mappedCount = allRows.filter((r) => r.mapping).length;
  const blockedCount = allRows.filter((r) => r.mapping && precheck[r.trimId]?.ok === false).length;

  const confBadge = (m: MappingRow["mapping"]) => {
    if (!m) return null;
    const label = m.source === "manual" ? "수동" : m.confidence === "exact" ? "자동·정확" : "자동·유사";
    const cls =
      m.source === "manual"
        ? "bg-indigo-50 text-indigo-600"
        : m.confidence === "exact"
          ? "bg-emerald-50 text-emerald-600"
          : "bg-amber-50 text-amber-600";
    return <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
  };

  // 칩의 매핑 현황 색 — 완료(초록) / 일부(주황) / 없음(흰색)
  const chipTone = (vid: string, selected: boolean) => {
    if (selected) return "border-[#6066EE] bg-[#6066EE] text-white font-semibold";
    const s = summary[vid];
    if (!s || s.total === 0 || s.mapped === 0) return "border-[#E8EAF2] bg-white text-[#3A3F5C] hover:border-[#C9CEEA]";
    if (s.mapped >= s.total) return "border-emerald-200 bg-emerald-50 text-[#3A3F5C] hover:border-emerald-300";
    return "border-amber-200 bg-amber-50 text-[#3A3F5C] hover:border-amber-300";
  };

  return (
    <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-4 flex flex-col gap-3">
      {/* ① 브랜드 — 수집 화면과 같은 버튼 명단 */}
      <div className="flex flex-wrap gap-2">
        {brands.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => {
              setBrand(brand === b ? "" : b);
              setVehicleQuery("");
            }}
            className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
              brand === b
                ? "border-[#6066EE] bg-[#F0F1FA] text-[#3A41C8] font-semibold"
                : "border-[#E8EAF2] text-[#5A6080] hover:border-[#C9CEEA]"
            }`}
          >
            {b}
          </button>
        ))}
      </div>

      {/* ② 차량 칩 명단 — 여러 대 선택 가능, 칩에 매핑 현황 표시 */}
      {brand && (
        <div className="rounded-xl border border-[#EDEFF6] bg-[#FAFBFF] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-bold text-[#3A41C8]">
              {brand}
              <span className="ml-2 font-normal text-[#9BA4C0]">
                {selectedIds.length > 0 ? `${selectedIds.length}대 선택 / ${brandVehicles.length}대` : `${brandVehicles.length}대`}
              </span>
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#B0B8D0]">
                매핑: <span className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[#3A3F5C]">완료</span>{" "}
                <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[#3A3F5C]">일부</span>{" "}
                <span className="rounded border border-[#E8EAF2] bg-white px-1.5 py-0.5 text-[#3A3F5C]">없음</span>
              </span>
              <input
                value={vehicleQuery}
                onChange={(e) => setVehicleQuery(e.target.value)}
                placeholder="차량명 검색"
                className="h-7 w-32 rounded-lg border border-[#E8EAF2] px-2 text-xs text-[#3A3F5C] placeholder:text-[#B0B8D0] focus:border-[#6066EE] focus:outline-none"
              />
            </div>
          </div>
          {brandVehicles.length === 0 ? (
            <p className="mt-2 text-[11px] text-[#9BA4C0]">검색 결과가 없습니다.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {brandVehicles.map((v) => {
                const selected = selectedIds.includes(v.id);
                const s = summary[v.id];
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggleVehicle(v.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${chipTone(v.id, selected)}`}
                  >
                    {v.name}
                    {s && s.total > 0 && (
                      <span className={`ml-1 text-[10px] ${selected ? "text-white/70" : "text-[#8890AC]"}`}>
                        {s.mapped}/{s.total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void suggestFor(selectedIds)}
            disabled={suggesting || loadingIds.size > 0}
            className="rounded-lg bg-[#6066EE] px-3 py-2 text-xs font-bold text-white hover:bg-[#4F55D8] disabled:opacity-40"
          >
            {suggesting ? "분석 중…" : "자동 매핑 제안"}
          </button>
          {hasSuggestions && (
            <button
              type="button"
              onClick={() => void adoptAll()}
              disabled={adopting}
              className="rounded-lg border border-[#6066EE] px-3 py-2 text-xs font-bold text-[#6066EE] hover:bg-[#F0F1FA] disabled:opacity-40"
            >
              {adopting ? "채택 중…" : "제안 전체 채택"}
            </button>
          )}
          <span className="text-xs text-[#9BA4C0]">
            매핑 {mappedCount}/{allRows.length}
            {blockedCount > 0 && <span className="text-amber-600"> · 반영불가 {blockedCount}</span>}
          </span>
        </div>
      )}
      {notice && (
        <p className={`text-xs font-semibold ${notice.ok ? "text-emerald-600" : "text-red-500"}`}>
          {notice.ok ? "✅ " : "❌ "}
          {notice.text}
        </p>
      )}
      {suggestWarning && <p className="text-xs text-amber-600">{suggestWarning}</p>}

      {/* 차량별 트림 매핑 카드 */}
      {selectedVehicles.map((v) => {
        const rows = rowsByVehicle[v.id] ?? [];
        const vMapped = rows.filter((r) => r.mapping).length;
        return (
          <div key={v.id} className="rounded-lg border border-[#E8EAF2]">
            <div className="flex flex-wrap items-center gap-2 border-b border-[#F0F1FA] bg-[#F8F9FC] px-3 py-2">
              <span className="text-sm font-bold text-[#1A1A2E]">{v.name}</span>
              <span className="text-xs text-[#9BA4C0]">매핑 {vMapped}/{rows.length}</span>
              <button
                type="button"
                onClick={() => toggleVehicle(v.id)}
                className="ml-auto text-[11px] text-[#9BA4C0] hover:text-[#C0392B] hover:underline"
              >
                선택 해제
              </button>
            </div>
            <div className="divide-y divide-[#F0F1FA]">
              {loadingIds.has(v.id) ? (
                <p className="py-6 text-center text-sm text-[#9BA4C0]">로딩 중…</p>
              ) : (
                rows.map((r) => {
                  const s = suggestions[r.trimId];
                  const mapping = r.mapping;
                  const status = mapping ? precheck[r.trimId] : undefined;
                  const blocked = status?.ok === false;
                  return (
                    <div key={r.trimId} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={applySel.has(r.trimId)}
                          disabled={!mapping || blocked}
                          onChange={() =>
                            setApplySel((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.trimId)) next.delete(r.trimId);
                              else next.add(r.trimId);
                              return next;
                            })
                          }
                          className="h-3.5 w-3.5 accent-[#6066EE]"
                        />
                        <span className="font-medium text-[#1A1A2E]">{r.trimName}</span>
                        <span className="text-xs text-[#9BA4C0]">{r.price.toLocaleString()}원</span>
                        {confBadge(mapping)}
                        {mapping?.newerYearAvailable && (
                          <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-bold text-orange-600" title="카탈로그에 더 최신 연식이 있습니다 — 자동 제안으로 재매핑을 검토하세요">
                            새 연식 후보
                          </span>
                        )}
                        {blocked && (
                          <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-500" title={status?.reason}>
                            반영불가
                          </span>
                        )}
                        <div className="ml-auto flex items-center gap-2">
                          {mapping ? (
                            <>
                              <span className="text-xs text-[#5A6080]">
                                → {mapping.externalLabel} <span className="text-[#9BA4C0]">({mapping.catalogTrim.vehiclePrice.toLocaleString()}원)</span>
                              </span>
                              <button type="button" onClick={() => void removeMapping(v.id, mapping.id)} className="text-[11px] text-[#C0392B] hover:underline">
                                해제
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-[#C9CEEA]">미매핑</span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSearchRow(searchRow === r.trimId ? null : r.trimId);
                              setSearchQ("");
                              setSearchResults([]);
                            }}
                            className="text-[11px] text-[#6066EE] hover:underline"
                          >
                            수동 검색
                          </button>
                        </div>
                      </div>
                      {/* 반영 불가 사유 — 배지에 마우스를 올리지 않아도 보이게 */}
                      {blocked && status?.reason && <p className="mt-1 ml-6 text-[11px] text-red-500">{status.reason}</p>}

                      {/* 자동 제안 미리보기 */}
                      {s && (
                        <div className="mt-1.5 ml-6 flex flex-wrap items-center gap-2 rounded-lg bg-[#F8F9FC] px-2.5 py-1.5 text-xs">
                          <span className="text-[#5A6080]">
                            제안: <b>{s.label}</b> ({s.vehiclePrice.toLocaleString()}원 · {s.confidence === "exact" ? "정확" : "유사"})
                          </span>
                          <button
                            type="button"
                            onClick={() => void saveMapping(v.id, r.trimId, s.catalogTrimId, "auto", s.confidence)}
                            className="rounded bg-[#6066EE] px-2 py-1 text-[11px] font-bold text-white"
                          >
                            채택
                          </button>
                        </div>
                      )}

                      {/* 수동 검색 콤보 */}
                      {searchRow === r.trimId && (
                        <div className="mt-1.5 ml-6">
                          <input
                            type="text"
                            value={searchQ}
                            onChange={(e) => void runSearch(e.target.value)}
                            placeholder="카탈로그 트림명/모델명 검색 (2자 이상)…"
                            autoFocus
                            className="w-full max-w-md rounded-lg border border-[#E8EAF2] px-3 py-1.5 text-xs focus:border-[#6066EE] focus:outline-none"
                          />
                          {searchResults.length > 0 && (
                            <div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-[#E8EAF2] divide-y divide-[#F0F1FA]">
                              {searchResults.map((c) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => {
                                    void saveMapping(v.id, r.trimId, c.id, "manual");
                                    setSearchRow(null);
                                  }}
                                  className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#F0F1FA]"
                                >
                                  <b>{c.modelName}</b> {c.trimName}
                                  {c.modelYear ? ` [${c.modelYear}]` : ""} · {c.vehiclePrice.toLocaleString()}원
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}

      {/* 견적 반영 */}
      {selectedIds.length > 0 && allRows.length > 0 && (
        <div className="rounded-lg border border-[#E8EAF2] bg-[#F8F9FC] px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void apply()}
              disabled={applying || applySel.size === 0}
              className="rounded-lg bg-[#000666] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              {applying ? "반영 중…" : `견적 반영 (${applySel.size}개 트림)`}
            </button>
            <span className="text-[11px] text-[#9BA4C0]">
              매핑된 카탈로그 값으로 트림별 정확값 회수율 시트를 생성합니다 (min=max, 이번 주 기준 · 기존 활성 시트는 이력으로 보존)
            </span>
            {applyResult && <span className="text-xs font-semibold text-[#1A1A2E]">{applyResult}</span>}
          </div>
          {applyDetails.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-[#5A6080]">건너뛴 트림 사유 {applyDetails.length}건 보기</summary>
              <ul className="mt-1 flex flex-col gap-0.5">
                {applyDetails.map((st) => (
                  <li key={st.trimId} className="text-[11px] text-[#9BA4C0]">
                    <b className="text-[#5A6080]">{st.label}</b> — {st.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

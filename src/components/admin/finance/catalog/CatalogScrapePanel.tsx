"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { resolveCapitalConnection } from "@/lib/scraper/connections";
import { brandsForAdapter } from "@/lib/scraper/capital-brands";
import ScraperLoginModal from "../ScraperLoginModal";
import WorkerStatusBadge from "../WorkerStatusBadge";
import type { CatalogJobState } from "./CapitalCatalogManager";
import type { ScrapeJobType } from "@/types/scraper";
import { FRESHNESS_LEGEND, freshness } from "./freshness";

interface Props {
  financeCompanyId: string;
  financeCompanyName: string;
  productType: string;
  job: CatalogJobState;
  onJobStarted: (jobId: string, jobType: ScrapeJobType) => void;
}

function weekOfMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().slice(0, 10);
}

const RUNNING_STATES = ["pending", "running", "needs_human"];
/** 트림 1건 수집에 걸리는 대략 시간(초) — 예상 소요시간 안내용. JB는 DOM 자동화라 더 느리다. */
const SEC_PER_TRIM = 6;

interface ModelOption {
  modelCd: string;
  modelName: string;
  trimCount: number;
  /** 마지막 수집 시각 — null 이면 아직 수집한 적 없는 차량. */
  lastScrapedAt: string | null;
}


/** 브랜드 전체를 돌지, 고른 차량만 돌지 — 암묵 규칙 대신 명시적으로 고르게 한다. */
type Scope = "all" | "picked";

/**
 * 카탈로그 수집 — 브랜드 → 차량 선택 → 수집.
 * 차량 목록은 [차량 목록 가져오기](models 잡)로 먼저 동기화한다(브랜드당 수 초).
 */
export default function CatalogScrapePanel({ financeCompanyId, financeCompanyName, productType, job, onJobStarted }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<Record<string, ModelOption[]>>({});
  const [modelSel, setModelSel] = useState<Record<string, Set<string>>>({});
  const [scope, setScope] = useState<Scope>("picked");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<"catalog" | "models" | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const brandOptions = useMemo(
    () => brandsForAdapter(resolveCapitalConnection(financeCompanyName)?.adapter),
    [financeCompanyName]
  );

  const isRunning = !!job.status && RUNNING_STATES.includes(job.status);
  const selectedBrands = brandOptions.filter((b) => selected.has(b.brandCd));

  const loadModels = useCallback(
    async (brandCd: string, force = false) => {
      if (models[brandCd] && !force) return;
      const params = new URLSearchParams({ financeCompanyId, productType, brandCd });
      const res = await fetch(`/api/admin/capital-catalog?${params}`);
      const data = await res.json().catch(() => ({}));
      setModels((prev) => ({ ...prev, [brandCd]: data.models ?? [] }));
    },
    [financeCompanyId, productType, models]
  );

  // 캐피탈사·상품타입이 바뀌면 이전 목록은 무효 — 선택도 함께 비운다.
  useEffect(() => {
    setModels({});
    setModelSel({});
    setSelected(new Set());
  }, [financeCompanyId, productType]);

  // 목록 동기화(models 잡)나 수집(catalog 잡)이 끝나면 선택된 브랜드 목록을 다시 읽는다
  // — 수집 후에는 트림 수·마지막 수집일이 바뀐다.
  useEffect(() => {
    if ((job.jobType !== "models" && job.jobType !== "catalog") || job.status !== "completed") return;
    for (const b of selectedBrands) void loadModels(b.brandCd, true);
    // selectedBrands/loadModels 는 매 렌더 새 참조라 의존성에서 제외한다 — 완료 시점 1회만 돈다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.jobType, job.status]);

  const toggleBrand = (brandCd: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(brandCd)) {
        next.delete(brandCd);
        setModelSel((s) => ({ ...s, [brandCd]: new Set() }));
      } else {
        next.add(brandCd);
        void loadModels(brandCd);
      }
      return next;
    });
  };

  const toggleModel = (brandCd: string, modelCd: string) => {
    setModelSel((prev) => {
      const next = new Set(prev[brandCd] ?? []);
      if (next.has(modelCd)) next.delete(modelCd);
      else next.add(modelCd);
      return { ...prev, [brandCd]: next };
    });
  };

  const setBrandModels = (brandCd: string, modelCds: string[]) =>
    setModelSel((prev) => ({ ...prev, [brandCd]: new Set(modelCds) }));

  // 고른 차량을 브랜드 구분 없이 한 줄로 — 브랜드 카드가 쌓여도 무엇을 골랐는지 한눈에 보인다.
  const picked = selectedBrands.flatMap((b) =>
    [...(modelSel[b.brandCd] ?? [])].map((modelCd) => {
      const m = models[b.brandCd]?.find((x) => x.modelCd === modelCd);
      return { brandCd: b.brandCd, brandName: b.name, modelCd, modelName: m?.modelName ?? modelCd, trimCount: m?.trimCount ?? 0 };
    })
  );
  const pickedTrims = picked.reduce((sum, p) => sum + p.trimCount, 0);
  const canCollect = scope === "all" ? selected.size > 0 : picked.length > 0;
  // 목록이 아직 없는 브랜드 = models 잡을 한 번도 안 돌린 브랜드
  const needSync = selectedBrands.filter((b) => (models[b.brandCd]?.length ?? 0) === 0);

  const createJob = async (body: Record<string, unknown>, jobType: ScrapeJobType) => {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch("/api/admin/scrape-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.jobId) {
        setPending(null);
        onJobStarted(data.jobId, jobType);
        return;
      }
      if (!res.ok || !data.jobId) {
        setStartError(data.error ?? "작업 생성에 실패했습니다.");
        return;
      }
      setPending(null);
      onJobStarted(data.jobId, jobType);
    } finally {
      setStarting(false);
    }
  };

  const submitLogin = (username: string, password: string, workerId: string) => {
    const brands = selectedBrands.map((b) => ({ brandCd: b.brandCd, name: b.name }));
    if (brands.length === 0) return;
    if (pending === "models") {
      void createJob({ jobType: "models", financeCompanyId, productType, brands, username, password, workerId }, "models");
      return;
    }
    // 선택 차량만 → modelCds 지정, 브랜드 전체 → 생략(어댑터가 전량 순회)
    const payloadBrands =
      scope === "picked"
        ? brands
            .map((b) => ({ ...b, modelCds: [...(modelSel[b.brandCd] ?? [])] }))
            .filter((b) => b.modelCds.length > 0)
        : brands;
    void createJob(
      { jobType: "catalog", financeCompanyId, productType, weekOf: weekOfMonday(), brands: payloadBrands, username, password, workerId },
      "catalog"
    );
  };

  const patchJob = async (action: "cancel" | "resume") => {
    if (!job.jobId) return;
    await fetch(`/api/admin/scrape-jobs/${job.jobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
  };

  const p = job.progress;
  const pct = p && p.trimsTotal > 0 ? Math.min(100, Math.round((p.trimsDone / p.trimsTotal) * 100)) : null;
  const isModelsJob = job.jobType === "models";

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-bold text-[#1A1A2E]">
            카탈로그 수집
            <span className="ml-2 font-normal text-xs text-[#9BA4C0]">{financeCompanyName} 등록 원본을 그대로 수집합니다</span>
          </p>
          <WorkerStatusBadge />
        </div>

        {/* ① 브랜드 */}
        <Step n={1} label="브랜드 선택" hint={selected.size > 0 ? `${selected.size}개 선택` : "여러 개 고를 수 있습니다"} />
        <div className="mt-2 flex flex-wrap gap-2">
          {brandOptions.map((b) => (
            <label
              key={b.brandCd}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${
                selected.has(b.brandCd)
                  ? "border-[#6066EE] bg-[#F0F1FA] text-[#3A41C8] font-semibold"
                  : "border-[#E8EAF2] text-[#5A6080] hover:border-[#C9CEEA]"
              }`}
            >
              <input
                type="checkbox"
                checked={selected.has(b.brandCd)}
                onChange={() => toggleBrand(b.brandCd)}
                disabled={isRunning}
                className="h-3.5 w-3.5 accent-[#6066EE]"
              />
              {b.name}
            </label>
          ))}
        </div>

        {/* ② 차량 */}
        {selectedBrands.length > 0 && (
          <>
            <Step
              n={2}
              label="차량 선택"
              hint={picked.length > 0 ? `${picked.length}대 선택 · 트림 ${pickedTrims}개` : "쏘렌토·스포티지·카니발처럼 여러 대를 한 번에 고를 수 있습니다"}
              right={
                <div className="flex items-center gap-2">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="차량명 검색"
                    className="h-7 w-32 rounded-lg border border-[#E8EAF2] px-2 text-xs text-[#3A3F5C] placeholder:text-[#B0B8D0] focus:border-[#6066EE] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => { setStartError(null); setPending("models"); }}
                    disabled={isRunning || starting}
                    title="캐피탈사 사이트에서 차량 목록만 가져옵니다 (브랜드당 수 초)"
                    className="rounded-lg border border-[#6066EE] px-2.5 py-1 text-[11px] font-bold text-[#6066EE] hover:bg-[#F0F1FA] disabled:opacity-40"
                  >
                    차량 목록 가져오기
                  </button>
                </div>
              }
            />

            {/* 수집일 색상 범례 */}
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#B0B8D0]">
              수집일:
              {FRESHNESS_LEGEND.map((l) => (
                <span key={l.label} className={`rounded border px-1.5 py-0.5 text-[#3A3F5C] ${l.swatch}`}>
                  {l.label}
                </span>
              ))}
            </p>

            {needSync.length > 0 && (
              <p className="mt-2 rounded-lg bg-[#FFF7E6] px-3 py-2 text-[11px] text-[#8A6D1F]">
                {needSync.map((b) => b.name).join(" · ")} — 차량 목록이 없습니다. [차량 목록 가져오기]를 먼저 누르세요 (트림 견적은 긁지 않아 금방 끝납니다).
              </p>
            )}

            {selectedBrands.map((b) => {
              const list = models[b.brandCd];
              const sel = modelSel[b.brandCd] ?? new Set<string>();
              const shown = (list ?? []).filter((m) => !query || m.modelName.toLowerCase().includes(query.toLowerCase()));
              if (list === undefined) {
                return (
                  <p key={b.brandCd} className="mt-2 text-[11px] text-[#9BA4C0]">
                    {b.name} 차량 목록 불러오는 중…
                  </p>
                );
              }
              if (list.length === 0) return null;
              return (
                <div key={b.brandCd} className="mt-2 rounded-xl border border-[#EDEFF6] bg-[#FAFBFF] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-bold text-[#3A41C8]">
                      {b.name}
                      <span className="ml-2 font-normal text-[#9BA4C0]">
                        {sel.size > 0 ? `${sel.size}/${list.length}대` : `${list.length}대`}
                      </span>
                    </p>
                    <div className="flex gap-2 text-[11px] font-semibold">
                      <button
                        type="button"
                        onClick={() => setBrandModels(b.brandCd, shown.map((m) => m.modelCd))}
                        disabled={isRunning}
                        className="text-[#6066EE] hover:underline disabled:opacity-40"
                      >
                        전체 선택
                      </button>
                      {sel.size > 0 && (
                        <button
                          type="button"
                          onClick={() => setBrandModels(b.brandCd, [])}
                          disabled={isRunning}
                          className="text-[#9BA4C0] hover:underline disabled:opacity-40"
                        >
                          해제
                        </button>
                      )}
                    </div>
                  </div>
                  {shown.length === 0 ? (
                    <p className="mt-2 text-[11px] text-[#9BA4C0]">검색 결과가 없습니다.</p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {shown.map((m) => (
                        <button
                          key={m.modelCd}
                          type="button"
                          onClick={() => toggleModel(b.brandCd, m.modelCd)}
                          disabled={isRunning}
                          className={`rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                            sel.has(m.modelCd)
                              ? "border-[#6066EE] bg-[#6066EE] text-white font-semibold"
                              : // 검은 글씨 + 신선도 배경색 (1주=초록 · 1달=주황 · 그 이상/미수집=빨강)
                                `${freshness(m.lastScrapedAt).border} ${freshness(m.lastScrapedAt).bg} text-[#3A3F5C]`
                          }`}
                        >
                          {m.modelName}
                          {m.trimCount > 0 && (
                            <span className={sel.has(m.modelCd) ? "ml-1 text-white/70" : "ml-1 text-[#8890AC]"}>{m.trimCount}</span>
                          )}
                          <span className={`ml-1 text-[10px] ${sel.has(m.modelCd) ? "text-white/70" : "text-[#5A6080]"}`}>
                            {freshness(m.lastScrapedAt).label}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* 고른 차량 요약 — 브랜드 카드가 여러 개여도 여기서 전부 확인·해제 */}
            {picked.length > 0 && (
              <div className="mt-3 rounded-xl border border-[#D8DCF5] bg-[#F7F8FF] p-3">
                <p className="text-[11px] font-bold text-[#3A41C8]">고른 차량 {picked.length}대</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {picked.map((m) => (
                    <button
                      key={`${m.brandCd}:${m.modelCd}`}
                      type="button"
                      onClick={() => toggleModel(m.brandCd, m.modelCd)}
                      disabled={isRunning}
                      title="클릭하면 선택에서 뺍니다"
                      className="rounded-full border border-[#6066EE] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#3A41C8] hover:bg-[#F0F1FA] disabled:opacity-40"
                    >
                      <span className="text-[#9BA4C0]">{m.brandName}</span> {m.modelName} ✕
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ③ 수집 */}
        {selectedBrands.length > 0 && (
          <>
            <Step n={3} label="수집 범위" />
            <div className="mt-2 flex flex-wrap gap-2">
              <ScopeOption
                active={scope === "picked"}
                disabled={isRunning}
                onClick={() => setScope("picked")}
                title="고른 차량만"
                desc={picked.length > 0 ? `${picked.length}대 · 트림 ${pickedTrims}개 · 약 ${estimate(pickedTrims)}` : "위에서 차량을 고르세요"}
              />
              <ScopeOption
                active={scope === "all"}
                disabled={isRunning}
                onClick={() => setScope("all")}
                title="브랜드 전체"
                desc={`${selected.size}개 브랜드 전량 · 수 분~수십 분`}
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => { setStartError(null); setPending("catalog"); }}
                disabled={!canCollect || isRunning || starting}
                className="rounded-lg bg-[#6066EE] px-4 py-2 text-sm font-bold text-white hover:bg-[#4F55D8] disabled:opacity-40"
              >
                수집 시작
              </button>
              <span className="text-[11px] text-[#B0B8D0]">
                워커 실행 중이어야 함 · JB우리캐피탈은 더 느립니다 · 중단해도 수집분은 저장되고 같은 주엔 이어서 수집
              </span>
            </div>
          </>
        )}
        {startError && !pending && (
          <p className="mt-2 text-xs font-medium text-red-500">{startError}</p>
        )}
      </div>

      {/* 진행/결과 카드 */}
      {job.jobId && (
        <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#1A1A2E]">
              {job.status === "completed" && (isModelsJob ? "✅ 차량 목록 동기화 완료" : "✅ 수집 완료")}
              {job.status === "failed" && "❌ 실패"}
              {job.status === "canceled" && "⏹ 취소됨"}
              {job.status === "needs_human" && "✋ 확인 필요"}
              {(job.status === "pending" || job.status === "running") &&
                (isModelsJob ? "⏳ 차량 목록 가져오는 중…" : "⏳ 수집 중…")}
            </p>
            <div className="flex gap-2">
              {job.status === "needs_human" && (
                <button type="button" onClick={() => patchJob("resume")} className="rounded-lg bg-[#6066EE] px-3 py-1.5 text-xs font-bold text-white">
                  재개
                </button>
              )}
              {isRunning && (
                <button
                  type="button"
                  onClick={() => patchJob("cancel")}
                  title="지금까지 수집분은 저장됩니다"
                  className="rounded-lg border border-[#C0392B] px-3 py-1.5 text-xs font-bold text-[#C0392B] hover:bg-red-50"
                >
                  취소
                </button>
              )}
            </div>
          </div>

          {job.humanPrompt && <p className="mt-2 text-xs text-amber-600">{job.humanPrompt}</p>}
          {job.error && <p className="mt-2 text-xs text-red-500">{job.error}</p>}

          {isRunning && !isModelsJob && p && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-[#5A6080]">
                <span>
                  브랜드 {p.brandIdx}/{p.brandCount} <b>{p.brandName}</b> · 모델 {p.modelIdx}/{p.modelCount} <b>{p.modelName}</b>
                </span>
                <span>
                  트림 {p.trimsDone}/{p.trimsTotal}
                  {p.skipped > 0 && ` (기수집 ${p.skipped} 스킵)`}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-[#F0F1FA] overflow-hidden">
                <div className="h-full rounded-full bg-[#6066EE] transition-all" style={{ width: `${pct ?? 5}%` }} />
              </div>
            </div>
          )}
          {isRunning && !p && <p className="mt-2 text-xs text-[#9BA4C0]">워커 클레임 대기 중… (워커가 꺼져 있으면 시작되지 않습니다)</p>}

          {job.status === "completed" && job.summary?.mode === "models" && (
            <p className="mt-2 text-xs text-[#5A6080]">
              차량 <b>{job.summary.total}</b>대 확인
              <span className="ml-2 text-[#9BA4C0]">({job.summary.brands.map((b) => `${b.name} ${b.models}`).join(" · ")})</span>
              <span className="ml-2 text-emerald-600 font-semibold">→ 위에서 차량을 골라 수집하세요</span>
            </p>
          )}
          {job.status === "completed" && job.summary?.mode === "catalog" && (
            <div className="mt-2 text-xs text-[#5A6080]">
              <p>
                트림 <b>{job.summary.total}</b>건 수집 · 기수집 스킵 {job.summary.skipped}건 · 실패 {job.summary.failed}건
                {job.summary.brands.length > 0 && (
                  <span className="ml-2 text-[#9BA4C0]">({job.summary.brands.map((b) => `${b.name} ${b.trims}`).join(" · ")})</span>
                )}
                <span className="ml-2 text-emerald-600 font-semibold">→ 카탈로그 열람·매핑 탭에서 확인하세요</span>
              </p>
              {/* 이번에 수집된 차량 — 어떤 차가 들어왔는지 완료 화면에서 바로 확인 */}
              {(job.summary.models?.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {job.summary.models!.map((m) => (
                    <span
                      key={`${m.brandName}:${m.modelName}`}
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                    >
                      <span className="text-emerald-500">{m.brandName}</span> {m.modelName} · {m.trims}건
                    </span>
                  ))}
                </div>
              )}
              {/* 실패 내역 — 무엇이 왜 실패했는지 (어댑터가 상한 30건까지 동봉, 구버전 워커 결과엔 없음) */}
              {(job.summary.failures?.length ?? 0) > 0 && (
                <div className="mt-2 rounded-lg border border-red-100 bg-red-50/60 px-3 py-2 space-y-0.5">
                  <p className="text-[11px] font-semibold text-red-600">실패 내역</p>
                  {job.summary.failures!.map((f, i) => (
                    <p key={i} className="text-[11px] text-red-600">
                      <span className="font-semibold">{f.label}</span>
                      <span className="text-red-400"> — {f.reason}</span>
                    </p>
                  ))}
                  {job.summary.failed > job.summary.failures!.length && (
                    <p className="text-[11px] text-red-400">외 {job.summary.failed - job.summary.failures!.length}건 — 워커 콘솔 로그 참고</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {pending && (
        <ScraperLoginModal
          financeCompanyName={financeCompanyName}
          requiresHuman={resolveCapitalConnection(financeCompanyName)?.requiresHuman ?? false}
          submitting={starting}
          serverError={startError}
          onClose={() => setPending(null)}
          onSubmit={submitLogin}
        />
      )}
    </div>
  );
}

/** 트림 수 → 사람이 읽는 예상 소요시간. */
function estimate(trims: number): string {
  if (trims === 0) return "—";
  const sec = trims * SEC_PER_TRIM;
  if (sec < 90) return `${sec}초`;
  const min = Math.round(sec / 60);
  return min < 60 ? `${min}분` : `${Math.round(min / 60)}시간`;
}

function Step({ n, label, hint, right }: { n: number; label: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0F1F6] pt-3 first:border-0">
      <p className="flex items-center gap-2 text-xs font-bold text-[#3A3F5C]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#6066EE] text-[10px] font-bold text-white">{n}</span>
        {label}
        {hint && <span className="font-normal text-[#9BA4C0]">{hint}</span>}
      </p>
      {right}
    </div>
  );
}

function ScopeOption({
  active, disabled, onClick, title, desc,
}: { active: boolean; disabled: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 min-w-[180px] rounded-xl border px-3 py-2 text-left transition-colors disabled:opacity-40 ${
        active ? "border-[#6066EE] bg-[#F0F1FA]" : "border-[#E8EAF2] bg-white hover:border-[#C9CEEA]"
      }`}
    >
      <p className={`text-xs font-bold ${active ? "text-[#3A41C8]" : "text-[#5A6080]"}`}>{title}</p>
      <p className="mt-0.5 text-[11px] text-[#9BA4C0]">{desc}</p>
    </button>
  );
}

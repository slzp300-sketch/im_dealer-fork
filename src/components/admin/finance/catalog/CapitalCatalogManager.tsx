"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveCapitalConnection } from "@/lib/scraper/connections";
import { PRODUCT_TYPE_VALUES, productTypeLabel, type ProductTypeValue } from "@/constants/product-type";
import { isExcelCapital } from "@/lib/scraper/excel-capitals";
import type { CatalogProgress, CatalogScrapeSummary, ModelsJobSummary, ScrapeJobStatus, ScrapeJobType } from "@/types/scraper";
import CatalogScrapePanel from "./CatalogScrapePanel";
import CatalogUploadPanel from "./CatalogUploadPanel";
import CatalogBrowser from "./CatalogBrowser";
import CatalogMappingPanel from "./CatalogMappingPanel";

/** 웹 스크래핑 또는 엑셀 업로드 중 하나라도 지원되면 true. */
const isSupportedCapital = (name: string) => !!resolveCapitalConnection(name) || isExcelCapital(name);

interface FcLite {
  id: string;
  name: string;
}
interface VehicleLite {
  id: string;
  brand: string;
  name: string;
}
interface Props {
  financeCompanies: FcLite[];
  vehicles: VehicleLite[];
}

export interface CatalogJobState {
  jobId: string | null;
  jobType: ScrapeJobType | null;
  status: ScrapeJobStatus | null;
  progress: CatalogProgress | null;
  // catalog 잡은 CatalogScrapeSummary, models 잡은 ModelsJobSummary — mode 로 구분한다.
  summary: CatalogScrapeSummary | ModelsJobSummary | null;
  error: string | null;
  humanPrompt: string | null;
}

const EMPTY_JOB: CatalogJobState = { jobId: null, jobType: null, status: null, progress: null, summary: null, error: null, humanPrompt: null };
const TERMINAL: ScrapeJobStatus[] = ["completed", "failed", "canceled"];

/**
 * 캐피탈사 데이터 탭 — 캐피탈사별 카탈로그(등록 전 트림) 수집·열람·매핑·견적 반영.
 * 잡 폴링은 이 레벨이 소유해 서브탭을 오가도 진행 상태가 유지된다.
 */
export default function CapitalCatalogManager({ financeCompanies, vehicles }: Props) {
  const supported = financeCompanies.filter((f) => isSupportedCapital(f.name));
  const [selectedFcId, setSelectedFcId] = useState<string>(supported[0]?.id ?? "");
  const [productType, setProductType] = useState<ProductTypeValue>("장기렌트");
  const [subTab, setSubTab] = useState<"collect" | "browse" | "map">("collect");
  const [job, setJob] = useState<CatalogJobState>(EMPTY_JOB);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedFc = financeCompanies.find((f) => f.id === selectedFcId);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollOnce = useCallback(async (jobId: string) => {
    try {
      const data = await (await fetch(`/api/admin/scrape-jobs/${jobId}`)).json();
      const j = data.job;
      if (!j) return;
      setJob((prev) => ({
        ...prev,
        jobId,
        status: j.status,
        progress: (j.progress as CatalogProgress | null) ?? prev.progress,
        summary: j.status === "completed" ? ((j.draft as CatalogScrapeSummary | ModelsJobSummary | null) ?? null) : prev.summary,
        error: j.error ?? null,
        humanPrompt: j.humanPrompt ?? null,
      }));
      if (TERMINAL.includes(j.status)) stopPolling();
    } catch {
      /* 일시 오류 — 다음 폴링에서 재시도 */
    }
  }, [stopPolling]);

  const watchJob = useCallback(
    (jobId: string, jobType: ScrapeJobType) => {
      stopPolling();
      setJob({ ...EMPTY_JOB, jobId, jobType, status: "pending" });
      void pollOnce(jobId);
      pollRef.current = setInterval(() => void pollOnce(jobId), 5000);
    },
    [pollOnce, stopPolling]
  );

  useEffect(() => stopPolling, [stopPolling]);

  // 화면 진입·캐피탈사 변경 시 서버의 활성 작업을 복원한다 — 새로고침해도
  // 진행 중/개입필요 작업 카드가 살아 있어야 취소·재개가 가능하다.
  useEffect(() => {
    if (!selectedFcId) return;
    let stale = false;
    (async () => {
      try {
        const d = await (
          await fetch(`/api/admin/scrape-jobs?financeCompanyId=${selectedFcId}&productType=${encodeURIComponent(productType)}`)
        ).json();
        const active = (d.jobs ?? []).find(
          (j: { id: string; jobType: ScrapeJobType }) => j.jobType === "models" || j.jobType === "catalog"
        );
        if (!stale && active) watchJob(active.id, active.jobType);
      } catch {
        /* 조회 실패는 무시 — 새 작업 시작 흐름에는 영향 없음 */
      }
    })();
    return () => {
      stale = true;
    };
  }, [selectedFcId, productType, watchJob]);

  // 캐피탈사 변경 시 잡 상태 초기화 (다른 캐피탈사 잡을 계속 보지 않도록)
  const handleFcChange = (id: string) => {
    setSelectedFcId(id);
    stopPolling();
    setJob(EMPTY_JOB);
  };

  const subTabs = [
    { id: "collect", label: "카탈로그 수집" },
    { id: "browse", label: "카탈로그 열람" },
    { id: "map", label: "매핑·견적 반영" },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      {/* 캐피탈사 선택 + 상품 타입 */}
      <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#9BA4C0] uppercase tracking-wider">캐피탈사</span>
          <select
            value={selectedFcId}
            onChange={(e) => handleFcChange(e.target.value)}
            className="rounded-lg border border-[#D7DBF0] px-3 py-2 text-sm focus:border-[#6066EE] focus:outline-none"
          >
            {financeCompanies.map((f) => {
              const ok = isSupportedCapital(f.name);
              return (
                <option key={f.id} value={f.id} disabled={!ok}>
                  {f.name}
                  {!ok ? " (미지원)" : ""}
                </option>
              );
            })}
          </select>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-[#E8EAF2] p-0.5">
          {PRODUCT_TYPE_VALUES.map((pt) => (
            <button
              key={pt}
              type="button"
              onClick={() => setProductType(pt)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                productType === pt ? "bg-[#6066EE] text-white" : "text-[#9BA4C0] hover:text-[#5A6080]"
              }`}
            >
              {productTypeLabel(pt)}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 bg-[#F8F9FC] p-1 rounded-xl">
          {subTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3 sm:px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                subTab === t.id ? "bg-white text-[#3A41C8] shadow-sm" : "text-[#9BA4C0] hover:text-[#5A6080]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!selectedFc ? (
        <div className="bg-white rounded-2xl border border-[#E8EAF0] shadow-sm p-10 text-center text-sm text-[#9BA4C0]">
          지원되는 캐피탈사가 없습니다. (현재 지원: 오릭스캐피탈)
        </div>
      ) : (
        <>
          {subTab === "collect" &&
            (isExcelCapital(selectedFc.name) ? (
              <CatalogUploadPanel
                financeCompanyId={selectedFcId}
                financeCompanyName={selectedFc.name}
              />
            ) : (
              <CatalogScrapePanel
                financeCompanyId={selectedFcId}
                financeCompanyName={selectedFc.name}
                productType={productType}
                job={job}
                onJobStarted={watchJob}
              />
            ))}
          {subTab === "browse" && <CatalogBrowser financeCompanyId={selectedFcId} productType={productType} />}
          {subTab === "map" && (
            <CatalogMappingPanel financeCompanyId={selectedFcId} productType={productType} vehicles={vehicles} />
          )}
        </>
      )}
    </div>
  );
}

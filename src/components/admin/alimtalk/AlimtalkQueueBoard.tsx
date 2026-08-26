import { Inbox, Send, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/admin-queries/shared";
import type {
  AlimtalkFailedItem,
  AlimtalkQueueStatus,
  AlimtalkStatus,
} from "@/lib/admin-queries/alimtalk-queue";

// 서버 컴포넌트 — 페이지 진입 시점의 SSR 스냅샷만 렌더한다(폴링 없음).

const STATUS_CARDS: {
  key: AlimtalkStatus;
  label: string;
  desc: string;
  tone: string;
}[] = [
  { key: "PENDING", label: "대기", desc: "릴레이 픽업 대기", tone: "bg-amber-50 text-amber-700" },
  { key: "SENDING", label: "전송 중", desc: "릴레이 처리 중", tone: "bg-blue-50 text-blue-600" },
  { key: "ACCEPTED", label: "접수됨", desc: "비즈톡 접수 · 결과 대기", tone: "bg-violet-50 text-violet-600" },
  { key: "SENT", label: "완료", desc: "고객 도달 완료", tone: "bg-emerald-50 text-emerald-600" },
  { key: "FAILED", label: "실패", desc: "발송 실패 · 확인 필요", tone: "bg-red-50 text-red-600" },
];

const REF_TYPE_LABEL: Record<string, string> = {
  quote: "견적",
  consult: "상담",
  review: "리뷰",
};

function failureReason(item: AlimtalkFailedItem): string {
  if (item.failReason) return item.failReason;
  if (item.resultCode) return `결과코드 ${item.resultCode}`;
  return "알 수 없음";
}

export function AlimtalkQueueBoard({ status }: { status: AlimtalkQueueStatus }) {
  const total = (Object.keys(status.counts) as AlimtalkStatus[]).reduce(
    (sum, key) => sum + status.counts[key],
    0
  );

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex flex-col">
        <h1 className="text-2xl font-bold text-[#1A1A2E] flex items-center gap-2">
          <Send size={20} className="text-[#000666]" /> 알림톡 발송 큐
        </h1>
        <p className="text-sm text-[#9BA4C0] mt-1">
          알림톡 큐(AlimtalkMessage)의 상태별 건수와 최근 실패 건을 보여줍니다. 페이지를 다시 열면 최신 상태로 갱신됩니다.
        </p>
      </div>

      {/* 빈 큐 안내 */}
      {total === 0 && (
        <div className="flex items-center gap-3 bg-white rounded-[12px] border border-[#E8EAF0] p-4 shadow-sm">
          <Inbox size={16} className="text-[#9BA4C0] shrink-0" />
          <p className="text-[13px] text-[#5A6080]">
            큐가 비어 있습니다 — 대기 중이거나 처리 중인 알림톡이 없습니다.
          </p>
        </div>
      )}

      {/* 상태별 카운트 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STATUS_CARDS.map(({ key, label, desc, tone }) => (
          <div
            key={key}
            className="bg-white rounded-[12px] border border-[#E8EAF0] p-4 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span
                className={cn(
                  "px-2 py-0.5 rounded-[4px] text-[11px] font-semibold",
                  tone
                )}
              >
                {label}
              </span>
              <span className="text-[10px] font-mono text-[#9BA4C0]">{key}</span>
            </div>
            <p className="mt-2 text-[26px] font-bold text-[#1A1A2E] tabular-nums leading-none">
              {status.counts[key].toLocaleString("ko-KR")}
            </p>
            <p className="text-[11px] text-[#9BA4C0] mt-1.5">{desc}</p>
            {key === "PENDING" && status.counts.PENDING > 0 && status.oldestPendingAt && (
              <p className="text-[11px] text-[#6B7399] mt-2">
                가장 오래된 대기 {formatRelativeTime(new Date(status.oldestPendingAt))}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* 최근 실패 목록 */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className="text-[#6066EE]" />
          <h2 className="text-[15px] font-semibold text-[#1A1A2E]">최근 실패</h2>
          <span className="text-[12px] text-[#9BA4C0]">
            최대 {status.recentFailures.length === 0 ? 10 : status.recentFailures.length}건 ·
            수신번호는 표시하지 않습니다
          </span>
        </div>

        <div className="bg-white rounded-[8px] border border-[#E8EAF0] overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="bg-[#F8F9FC] border-b border-[#E8EAF0]">
                <th className="text-left px-3 py-2.5 font-medium text-[#5A6080]">시각</th>
                <th className="text-left px-3 py-2.5 font-medium text-[#5A6080]">구분</th>
                <th className="text-left px-3 py-2.5 font-medium text-[#5A6080]">템플릿</th>
                <th className="text-left px-3 py-2.5 font-medium text-[#5A6080]">사유</th>
                <th className="text-left px-3 py-2.5 font-medium text-[#5A6080]">시도</th>
              </tr>
            </thead>
            <tbody>
              {status.recentFailures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-12 text-center text-[#9BA4C0]">
                    최근 실패 건이 없습니다.
                  </td>
                </tr>
              ) : (
                status.recentFailures.map((item) => (
                  <tr key={item.id} className="border-b border-[#F0F2F8] hover:bg-[#F8F9FC]">
                    <td className="px-3 py-2.5 align-top whitespace-nowrap">
                      <div className="text-[#1A1A2E]">
                        {formatRelativeTime(new Date(item.failedAt))}
                      </div>
                      <div className="text-[11px] text-[#9BA4C0] font-mono">
                        {item.failedAt.slice(0, 16).replace("T", " ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-[#1A1A2E]">
                        {item.refType ? (REF_TYPE_LABEL[item.refType] ?? item.refType) : "-"}
                      </div>
                      {item.refId && (
                        <div className="text-[11px] text-[#9BA4C0] font-mono truncate max-w-[120px]">
                          {item.refId}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[#1A1A2E] font-mono text-[11px]">
                      {item.templateKey}
                      <div className="text-[#9BA4C0] break-all">{item.templateCode}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top text-[#1A1A2E] break-words max-w-[320px]">
                      {failureReason(item)}
                    </td>
                    <td className="px-3 py-2.5 align-top text-[#5A6080] whitespace-nowrap">
                      {item.attempts}회
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

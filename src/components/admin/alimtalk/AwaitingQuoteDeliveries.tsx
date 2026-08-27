"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Hourglass, Send } from "lucide-react";
import { formatRelativeTime } from "@/lib/admin-queries/shared";
import type { AwaitingQuoteDelivery } from "@/lib/admin-queries/awaiting-quote-deliveries";

// 고객이 카카오 채널로 요청번호를 보내면 견적서가 자동으로 나간다. 문구를 지우고
// 보내는 고객이 있어 매칭이 실패할 수 있고, 그 건을 상담사가 여기서 직접 내보낸다.

export function AwaitingQuoteDeliveries({ items }: { items: AwaitingQuoteDelivery[] }) {
  const router = useRouter();
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(id: string) {
    setSendingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/admin/quote-deliveries/${id}/send`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : "발송하지 못했습니다.";
        setError(message);
        return;
      }
      // 목록에서 빠지고 알림톡 큐 카운트가 올라간다.
      router.refresh();
    } catch {
      setError("발송 중 오류가 발생했습니다.");
    } finally {
      setSendingId(null);
    }
  }

  return (
    <section className="rounded-xl border border-[#E6E9F5] bg-white p-5">
      <div className="flex items-center gap-2">
        <Hourglass size={16} className="text-amber-600" />
        <h2 className="text-base font-bold text-[#1A1A2E]">고객 메시지 대기</h2>
        <span className="text-sm text-[#9BA4C0]">{items.length}건</span>
      </div>
      <p className="mt-1 text-sm text-[#9BA4C0]">
        고객이 카카오 채널로 요청번호를 보내면 자동으로 발송됩니다. 상담에서 요청을 확인했는데
        번호가 없다면 여기서 직접 보내주세요.
      </p>

      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-[#9BA4C0]">대기 중인 요청이 없습니다.</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-[#E6E9F5]">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[#1A1A2E]">
                  {item.vehicleName}
                  <span className="ml-2 font-normal text-[#9BA4C0]">{item.customerName}</span>
                </p>
                <p className="mt-0.5 text-xs text-[#9BA4C0]">
                  요청번호 <span className="font-mono">{item.requestCode ?? "없음"}</span> ·{" "}
                  {formatRelativeTime(new Date(item.createdAt))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void send(item.id)}
                disabled={sendingId === item.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#000666] px-3 py-2 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                <Send size={14} />
                {sendingId === item.id ? "발송 중…" : "견적서 발송"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

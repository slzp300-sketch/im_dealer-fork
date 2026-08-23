"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Ticket } from "lucide-react";
import { REFERRAL_CODE_PATTERN } from "@/lib/referral/code";
import { readPendingReferralCode } from "@/lib/referral/pending-code";

interface ReferralCodeEntryCardProps {
  /** 창구 마감일 (KST, 예: 2026.08.25) */
  readonly deadlineLabel: string;
}

/**
 * 가입 때 추천인 코드를 깜빡한 회원의 사후 입력 카드.
 * 자격(가입 완료 14일 이내·미인정)이 있는 회원에게만 서버가 렌더한다.
 */
export function ReferralCodeEntryCard({ deadlineLabel }: ReferralCodeEntryCardProps) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const refreshTimer = useRef<number | null>(null);

  useEffect(() => {
    const pending = readPendingReferralCode();
    if (pending) setCode(pending);
  }, []);

  useEffect(() => {
    return () => {
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmed = code.trim().toUpperCase();
    if (!REFERRAL_CODE_PATTERN.test(trimmed)) {
      setError("추천인 코드 형식이 올바르지 않습니다. (예: K4821)");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/referral/redeem-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(json?.error ?? "처리 중 오류가 발생했습니다. 다시 시도해주세요.");
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      // 완료 문구를 읽을 시간을 준 뒤 서버 데이터(쿠폰 목록·카드 노출 조건)를 갱신한다.
      refreshTimer.current = window.setTimeout(() => router.refresh(), 1800);
    } catch {
      setError("네트워크 오류가 발생했습니다. 다시 시도해주세요.");
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <section className="mb-8 rounded-card border border-brand/25 bg-brand-soft p-4">
        <p className="flex items-center gap-2 text-[14px] font-extrabold text-brand">
          <CheckCircle2 size={18} className="shrink-0" />
          추천이 적용됐어요! 쿠폰함에서 혜택을 확인하세요.
        </p>
      </section>
    );
  }

  return (
    <section
      className="mb-8 rounded-card border border-brand/25 bg-brand-soft p-4 md:p-5"
      aria-labelledby="referral-entry-heading"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card bg-surface text-brand">
          <Ticket size={18} strokeWidth={2.1} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="referral-entry-heading" className="text-[15px] font-extrabold text-text-strong">
            추천인 코드가 있나요?
          </h2>
          <p className="mt-1 text-[12px] font-semibold leading-5 text-text-body">
            {deadlineLabel}까지 입력하면 추천 혜택 쿠폰을 받을 수 있어요.
          </p>
          <form onSubmit={handleSubmit} className="mt-3 flex flex-wrap gap-2">
            <label className="sr-only" htmlFor="referral-entry-code">
              추천인 코드
            </label>
            <input
              id="referral-entry-code"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={5}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="K4821"
              className="min-h-11 w-[130px] rounded-btn border border-border-subtle bg-surface px-3.5 font-mono text-[15px] font-semibold tracking-[0.14em] text-text-strong outline-none transition-colors focus:border-brand focus-visible:ring-4 focus-visible:ring-focus-ring/20"
            />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center rounded-btn bg-brand px-4 text-[13px] font-extrabold text-white transition-colors hover:bg-brand-pressed focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-focus-ring/40 disabled:cursor-wait disabled:opacity-70"
            >
              {submitting ? "적용 중…" : "적용하기"}
            </button>
          </form>
          {error ? (
            <p className="mt-2 text-[12px] font-semibold text-status-danger">{error}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

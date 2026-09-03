"use client";

import { useCallback, useState } from "react";
import { openChannelTalk } from "@/lib/channel-talk";
import { isMemberMobileConsultEnabled } from "@/lib/consult-entry";
import { isMobileDevice } from "@/lib/browser/device";
import { useAuthUser } from "@/hooks/useAuthUser";

export type ConsultEntryStatus = "idle" | "sending" | "sent" | "error";

/**
 * 상담 진입(「상담하기」) 결정을 한곳에 모은다 — 여러 버튼이 공유한다.
 *
 * 플래그(NEXT_PUBLIC_MEMBER_MOBILE_CONSULT)가 켜져 있고 모바일 로그인 회원이면,
 * 카카오 대화방을 여는 대신 서버로 POST 해 CONSULT_REQUEST 알림톡(상담톡전환 버튼)을
 * 회원의 등록 번호로 발송한다. 그 외(비회원·PC·플래그 꺼짐)에는 기존 동작(openChannelTalk)을
 * 그대로 쓴다. 알림톡 발송은 비동기지만 팝업과 달리 제스처 제약이 없어 await 해도 된다
 * (팝업처럼 await 후 window.open 을 시도하지 않는다).
 */
export function useConsultEntry(): {
  start: (source?: string) => void;
  status: ConsultEntryStatus;
  reset: () => void;
} {
  const { user } = useAuthUser();
  const [status, setStatus] = useState<ConsultEntryStatus>("idle");

  const reset = useCallback(() => setStatus("idle"), []);

  const start = useCallback(
    (source?: string) => {
      // 회원 + 모바일 + 플래그 ON 일 때만 알림톡 라우팅. 나머지는 기존 카카오/위젯.
      if (isMemberMobileConsultEnabled() && isMobileDevice() && user) {
        setStatus("sending");
        void (async () => {
          try {
            const res = await fetch("/api/public/consult", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ source: source ?? "consult" }),
            });
            if (res.ok) {
              setStatus("sent");
              return;
            }
            // 발송 실패 — 사용자가 상담에 닿도록 기존 진입으로 폴백한다.
            setStatus("error");
            openChannelTalk();
          } catch {
            setStatus("error");
            openChannelTalk();
          }
        })();
        return;
      }

      // 비회원·PC·플래그 꺼짐: 기존 동작(내부에서 모바일→카카오 / PC→위젯 분기).
      openChannelTalk();
    },
    [user],
  );

  return { start, status, reset };
}

import { enqueueAlimtalk } from "@/lib/alimtalk/enqueue";
import {
  buildConsultRequestButtons,
  buildConsultRequestMessage,
} from "@/lib/alimtalk/templates";

export type ConsultRequestTarget = {
  readonly phone: string;
  /** 로그인 회원이면 userId — 발송 이력 추적용. 비회원이면 생략. */
  readonly userId?: string;
  /** 유입 경로 라벨(이벤트·차량상세·AI추천 등). 상담사 데스크에 chat_extra 로 남는다. */
  readonly source?: string;
};

export type ConsultRequestAlimtalkResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "disabled" | "no_template_code" | "invalid_phone" };

/**
 * 상담 신청 안내톡(공용)을 큐에 적재한다(발송은 릴레이가 클레임).
 * 웹의 여러 상담 진입점이 공유하는 하나의 검수 템플릿(CONSULT_REQUEST)을 쓰고,
 * 유입 경로는 chat_extra(source)로만 구분한다 — 진입점마다 재검수받지 않기 위함.
 * 검수 승인 전(disabled/no_template_code)과 잘못된 번호(invalid_phone)는
 * 호출부가 상태코드로 되돌릴 수 있게 reason 으로 준다.
 */
export async function sendConsultRequestAlimtalk(
  target: ConsultRequestTarget,
): Promise<ConsultRequestAlimtalkResult> {
  const result = await enqueueAlimtalk({
    templateKey: "CONSULT_REQUEST",
    phone: target.phone,
    message: buildConsultRequestMessage(),
    buttons: buildConsultRequestButtons(target.source ?? "상담신청"),
    userId: target.userId,
    refType: "consult",
  });

  if (result.ok) return { ok: true };
  return { ok: false, reason: result.reason };
}

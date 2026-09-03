import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueAlimtalk: vi.fn(),
}));

vi.mock("@/lib/alimtalk/enqueue", () => ({
  enqueueAlimtalk: mocks.enqueueAlimtalk,
}));

import { CONSULT_REQUEST_DRAFT } from "@/lib/alimtalk/templates";
import { sendConsultRequestAlimtalk } from "./consult-request-alimtalk";

describe("sendConsultRequestAlimtalk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: true, id: "alim-1" });
  });

  it("CONSULT_REQUEST 를 상담톡전환(BC) 버튼과 함께 적재한다", async () => {
    const result = await sendConsultRequestAlimtalk({
      phone: "010-1234-5678",
      userId: "u-1",
      source: "이벤트상담",
    });

    expect(mocks.enqueueAlimtalk).toHaveBeenCalledWith({
      templateKey: "CONSULT_REQUEST",
      phone: "010-1234-5678",
      message: CONSULT_REQUEST_DRAFT,
      buttons: [{ name: "상담 시작하기", type: "BC", chat_extra: "이벤트상담" }],
      userId: "u-1",
      refType: "consult",
    });
    expect(result).toEqual({ ok: true });
  });

  // 진입 경로별 재검수 없이 하나의 템플릿을 쓰되, chat_extra 로만 경로를 구분한다.
  it("source 를 chat_extra 로 넘기고, 없으면 기본 라벨", async () => {
    await sendConsultRequestAlimtalk({ phone: "010-1234-5678" });
    const payload = mocks.enqueueAlimtalk.mock.calls[0]?.[0] as {
      buttons: { chat_extra: string }[];
    };
    expect(payload.buttons[0].chat_extra).toBe("상담신청");
  });

  it("본문에 광고·혜택 문구가 없다", async () => {
    await sendConsultRequestAlimtalk({ phone: "010-1234-5678" });
    const payload = mocks.enqueueAlimtalk.mock.calls[0]?.[0] as { message: string };
    expect(payload.message).not.toMatch(/쿠폰|할인|혜택|특가|이벤트 기간/);
  });

  it.each(["disabled", "no_template_code", "invalid_phone"] as const)(
    "적재 실패(%s)를 reason 으로 돌려준다",
    async (reason) => {
      mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason });
      await expect(sendConsultRequestAlimtalk({ phone: "010-1234-5678" })).resolves.toEqual({
        ok: false,
        reason,
      });
    },
  );
});

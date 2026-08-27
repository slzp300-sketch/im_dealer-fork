import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  requireActiveUser: vi.fn(),
  findSavedQuote: vi.fn(),
  buildOfficialImageData: vi.fn(),
  createDelivery: vi.fn(),
  updateDelivery: vi.fn(),
  findDelivery: vi.fn(),
  render: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  enqueueAlimtalk: vi.fn(),
  findNotification: vi.fn(),
  createNotification: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    savedQuote: { findFirst: mocks.findSavedQuote },
    quoteDelivery: {
      create: mocks.createDelivery,
      update: mocks.updateDelivery,
      findUnique: mocks.findDelivery,
    },
    adminNotification: {
      findFirst: mocks.findNotification,
      create: mocks.createNotification,
    },
  },
}));

vi.mock("@/lib/require-user", () => ({
  requireActiveUser: mocks.requireActiveUser,
}));

vi.mock("@/lib/quote-image/render-quote-image", () => ({
  renderQuoteImageBuffer: mocks.render,
}));

vi.mock("@/lib/quote-delivery/official-image", () => ({
  buildOfficialDeliveryImageData: mocks.buildOfficialImageData,
}));

vi.mock("@/lib/quote-delivery/store", () => ({
  uploadQuoteImage: mocks.upload,
  deleteQuoteImage: mocks.remove,
}));
vi.mock("@/lib/alimtalk/enqueue", () => ({
  enqueueAlimtalk: mocks.enqueueAlimtalk,
}));
vi.mock("@/lib/rate-limit", () => ({
  strictRateLimit: {},
  checkRateLimit: vi.fn(async () => null),
}));

function request(body?: Record<string, unknown>): NextRequest {
  return new NextRequest("https://example.com/api/quote/deliver", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      body ?? {
        vehicleName: "쏘렌토",
        scenarios: {
          conservative: quoteScenario(560_000, 8_000_000, 0),
          standard: quoteScenario(500_000, 0, 0),
          aggressive: quoteScenario(430_000, 0, 12_000_000),
        },
        savedQuoteId: "quote-1",
        sessionId: "session-1",
      }
    ),
  });
}

function quoteScenario(
  monthlyPayment: number,
  depositAmount: number,
  prepayAmount: number
): Record<string, unknown> {
  return {
    monthlyPayment,
    depositAmount,
    prepayAmount,
    contractMonths: 48,
    annualMileage: 20_000,
    contractType: "반납형",
    bestFinanceCompany: "테스트금융",
    purchaseSurcharge: 0,
    breakdown: null,
    surcharges: null,
    allFinanceResults: [],
  };
}

const officialImageData = {
  vehicleName: "서버 쏘렌토",
  vehicleBrand: "서버 기아",
  trimName: "서버 트림",
  trimPrice: 42_000_000,
  selectedOptions: [],
  totalVehiclePrice: 42_000_000,
  productType: "장기렌트",
  contractMonths: 48,
  annualMileage: 20_000,
  contractType: "반납형",
  scenarioType: "standard" as const,
  scenarios: {
    conservative: quoteScenario(560_000, 8_000_000, 0),
    standard: quoteScenario(500_000, 0, 0),
    aggressive: quoteScenario(430_000, 0, 12_000_000),
  },
  userEmail: null,
  exteriorColor: null,
  interiorColor: null,
};

const savedQuote = {
  id: "quote-1",
  vehicleId: "vehicle-1",
  trimId: "trim-1",
  contractMonths: 48,
  annualMileage: 20_000,
  depositRate: 0,
  prepayRate: 0,
  contractType: "반납형",
  monthlyPayment: 500_000,
  pricingStatus: "CALCULATED",
  breakdown: {},
  exteriorColorId: null,
  interiorColorId: null,
};

describe("POST /api/quote/deliver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "true");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://imdealer.example");
    mocks.requireActiveUser.mockResolvedValue({
      user: {
        id: "user-1",
        supabaseId: "sb-1",
        email: "a@b.com",
        name: "홍길동",
        phone: "01012345678",
      },
      error: null,
    });
    mocks.findSavedQuote.mockResolvedValue(savedQuote);
    mocks.buildOfficialImageData.mockResolvedValue({ ok: true, data: officialImageData });
    mocks.render.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mocks.upload.mockResolvedValue({ path: "deliveries/img.png" });
    mocks.remove.mockResolvedValue(undefined);
    mocks.createDelivery.mockResolvedValue({ id: "delivery-1" });
    mocks.findDelivery.mockResolvedValue(null);
    mocks.updateDelivery.mockResolvedValue({});
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: true, id: "alim-1" });
    mocks.findNotification.mockResolvedValue(null);
    mocks.createNotification.mockResolvedValue({ id: "notif-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("기능 플래그가 꺼져 있으면 전송 API도 비활성화한다", async () => {
    vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "false");

    const res = await POST(request());

    expect(res.status).toBe(404);
    expect(mocks.requireActiveUser).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  // 대기 모드: 상담이 먼저 열리게 하려고, 발송은 고객이 카카오 채널로 요청번호를
  // 보낸 뒤 채널톡 웹훅이 시작한다. 여기서는 견적서와 번호만 만들어 둔다.
  describe("고객 메시지 대기 모드", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "false");
      vi.stubEnv("QUOTE_DELIVERY_AWAIT_MESSAGE", "true");
    });

    it("자동발송이 꺼져 있어도 동작한다", async () => {
      const res = await POST(request());

      expect(res.status).toBe(200);
      expect(mocks.render).toHaveBeenCalled();
      expect(mocks.upload).toHaveBeenCalled();
    });

    // 견적서가 아니라 상담전환톡이 먼저 나간다. 견적서는 고객이 버튼을 눌러
    // 상담이 열린 뒤 채널톡 웹훅이 보낸다.
    it("견적서 대신 상담전환톡을 보내고 요청번호를 돌려준다", async () => {
      const res = await POST(request());
      const body = await res.json();

      expect(body.data.requestCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
      expect(mocks.enqueueAlimtalk).toHaveBeenCalledWith(
        expect.objectContaining({
          templateKey: "QUOTE_CONSULT",
          phone: "01012345678",
          buttons: [
            { name: "견적서 받기", type: "BC", chat_extra: body.data.requestCode },
          ],
        })
      );
      // 상담전환톡 본문에는 금액이 없다 — price 를 실으면 등록 내용과 어긋난다.
      expect(mocks.enqueueAlimtalk.mock.calls[0][0].price).toBeUndefined();
    });

    // 상담전환톡이 안 나가면 고객은 아무것도 못 받는다. 조용히 성공으로 닫지 않는다.
    it("상담전환톡 적재가 실패하면 502 로 끊는다", async () => {
      mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "no_template_code" });

      const res = await POST(request());

      expect(res.status).toBe(502);
      expect(mocks.remove).toHaveBeenCalled();
    });

    // 이 조합이면 화면은 "전송 완료"인데 아무것도 안 나간다. 자동발송을 우선한다.
    it("자동발송이 켜져 있으면 대기 모드를 무시하고 그대로 보낸다", async () => {
      vi.stubEnv("NEXT_PUBLIC_KAKAO_QUOTE_AUTO_SEND", "true");

      const res = await POST(request());
      const body = await res.json();

      expect(mocks.enqueueAlimtalk).toHaveBeenCalled();
      expect(body.data.requestCode).toBeUndefined();
    });

    it("발송 전이므로 AWAITING_MESSAGE 로 남긴다", async () => {
      await POST(request());

      expect(mocks.createDelivery).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "AWAITING_MESSAGE" }),
        })
      );
      // 아직 보내지 않았으므로 SENT 로 올리지 않는다.
      expect(mocks.updateDelivery).not.toHaveBeenCalled();
    });
  });

  it("비로그인은 401", async () => {
    mocks.requireActiveUser.mockResolvedValue({
      user: null,
      error: new Response(JSON.stringify({ error: "로그인이 필요합니다." }), { status: 401 }),
    });
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("필수 견적 정보가 없으면 400", async () => {
    const res = await POST(request({ vehicleName: "쏘렌토" }));
    expect(res.status).toBe(400);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("현재 회원이 저장한 견적과 세션이 아니면 403", async () => {
    mocks.findSavedQuote.mockResolvedValue(null);

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(mocks.findSavedQuote).toHaveBeenCalledWith({
      where: {
        id: "quote-1",
        sessionId: "session-1",
        userId: "sb-1",
        deletedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      select: {
        id: true,
        vehicleId: true,
        trimId: true,
        contractMonths: true,
        annualMileage: true,
        depositRate: true,
        prepayRate: true,
        contractType: true,
        monthlyPayment: true,
        pricingStatus: true,
        breakdown: true,
        exteriorColorId: true,
        interiorColorId: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("성공하면 업로드한 이미지를 보존 기간 동안 유지하며 발송하고 SENT 로 기록한다", async () => {
    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { deliveryId: "delivery-1" } });

    expect(mocks.upload).toHaveBeenCalledWith({ png: expect.any(Uint8Array) });
    // 채널 추가형 템플릿: 첫 버튼은 AC, 두 번째는 견적서 열람 웹링크.
    expect(mocks.enqueueAlimtalk).toHaveBeenCalledWith(
      expect.objectContaining({
        templateKey: "QUOTE_DELIVERED",
        phone: "01012345678",
        buttons: [
          { name: "채널 추가", type: "AC" },
          expect.objectContaining({
            name: "견적서 확인하기",
            type: "WL",
            url_mobile: "https://imdealer.example/quote/delivery/delivery-1",
            url_pc: "https://imdealer.example/quote/delivery/delivery-1",
          }),
        ],
        refType: "quote",
        refId: "quote-1",
      })
    );
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({ vehicleName: "서버 쏘렌토", userEmail: null })
    );
    expect(mocks.createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "user-1",
          savedQuoteId: "quote-1",
          imagePath: "deliveries/img.png",
          channel: "alimtalk",
          status: "PENDING",
        }),
      })
    );
    expect(mocks.updateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "delivery-1" },
        data: expect.objectContaining({ status: "SENT" }),
      })
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("ignores tampered client financial fields and renders only the server-built quote", async () => {
    const res = await POST(request({
      savedQuoteId: "quote-1",
      sessionId: "session-1",
      vehicleName: "위조 차량",
      totalVehiclePrice: 1,
      scenarios: {
        conservative: quoteScenario(1, 0, 0),
        standard: quoteScenario(1, 0, 0),
        aggressive: quoteScenario(1, 0, 0),
      },
    }));

    expect(res.status).toBe(200);
    expect(mocks.buildOfficialImageData).toHaveBeenCalledWith(savedQuote);
    expect(mocks.render).toHaveBeenCalledWith(officialImageData);
  });

  it("알림톡 적재 실패는 502 + FAILED 기록(사유 포함)", async () => {
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "invalid_phone" });

    const res = await POST(request());

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "카카오톡 전송에 실패했습니다. 다시 시도하거나 상담하기를 이용해 주세요.",
    });
    expect(mocks.updateDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          failReason: "invalid_phone",
        }),
      })
    );
    expect(mocks.remove).toHaveBeenCalledWith("deliveries/img.png");
  });

  it("업로드 후 이력 생성이 실패하면 공개 이미지를 삭제한다", async () => {
    mocks.createDelivery.mockRejectedValue(new Error("database unavailable"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(mocks.remove).toHaveBeenCalledWith("deliveries/img.png");
    expect(mocks.enqueueAlimtalk).not.toHaveBeenCalled();
  });

  it("업로드 실패는 500 이고 이력을 만들지 않는다", async () => {
    mocks.upload.mockRejectedValue(new Error("bucket not found"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(mocks.createDelivery).not.toHaveBeenCalled();
    expect(mocks.enqueueAlimtalk).not.toHaveBeenCalled();
  });

  it("이미지 상한인 5MB를 넘으면 업로드하지 않는다", async () => {
    mocks.render.mockResolvedValue(new Uint8Array(5 * 1024 * 1024 + 1));

    const res = await POST(request());

    expect(res.status).toBe(413);
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.createDelivery).not.toHaveBeenCalled();
    expect(mocks.enqueueAlimtalk).not.toHaveBeenCalled();
  });

  it("알림톡 적재가 실패하면 어드민 알림을 남긴다", async () => {
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "invalid_phone" });

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect(mocks.createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "SYSTEM",
        title: "알림톡 적재 실패",
        content: expect.stringContaining("유효한 전화번호 없음"),
        linkUrl: "/admin/quotations?id=quote-1&notice=alimtalk-enqueue",
      }),
    });
    const payload = mocks.createNotification.mock.calls[0][0].data as {
      content: string;
    };
    expect(payload.content).not.toContain("01012345678");
  });

  it("알림톡 적재 예외도 502 로 끊고 어드민 알림을 남긴다", async () => {
    mocks.enqueueAlimtalk.mockRejectedValue(new Error("alimtalk table unavailable"));

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect(mocks.createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "SYSTEM",
        title: "알림톡 적재 실패",
        linkUrl: "/admin/quotations?id=quote-1&notice=alimtalk-enqueue",
      }),
    });
  });

  // 알림톡이 유일한 발송 경로이므로, 스위치가 꺼져 있는 것도 조용히 넘길 수 없는 설정 사고다.
  it("알림톡이 꺼져 있으면 502 + 적재 실패 알림을 남긴다", async () => {
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "disabled" });

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect(mocks.createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "SYSTEM",
        title: "알림톡 적재 실패",
        linkUrl: "/admin/quotations?id=quote-1&notice=alimtalk-enqueue",
      }),
    });
  });

  it("같은 견적의 알림톡 적재 실패 알림은 재시도해도 한 건만 만든다", async () => {
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "no_template_code" });
    mocks.findNotification
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "notif-1" });

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(502);
    expect(second.status).toBe(502);
    expect(mocks.createNotification).toHaveBeenCalledTimes(1);
    expect(mocks.findNotification).toHaveBeenCalledWith({
      where: {
        type: "SYSTEM",
        linkUrl: "/admin/quotations?id=quote-1&notice=alimtalk-enqueue",
      },
      select: { id: true },
    });
  });

  it("알림 생성이 실패해도 적재 실패 응답(502)은 그대로 내려간다", async () => {
    mocks.enqueueAlimtalk.mockResolvedValue({ ok: false, reason: "invalid_phone" });
    mocks.createNotification.mockRejectedValue(new Error("notification insert failed"));

    const res = await POST(request());

    expect(res.status).toBe(502);
  });

  it("적재 성공 후 SENT 기록이 실패하면 같은 mark-failed 경로로 FAILED 를 남긴다", async () => {
    mocks.updateDelivery
      .mockRejectedValueOnce(new Error("sent write failed"))
      .mockResolvedValueOnce({});

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(mocks.enqueueAlimtalk).toHaveBeenCalledTimes(1);
    expect(mocks.updateDelivery).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { id: "delivery-1" },
        data: expect.objectContaining({ status: "SENT" }),
      })
    );
    expect(mocks.updateDelivery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: "delivery-1" },
        data: expect.objectContaining({
          status: "FAILED",
          failReason: "sent write failed",
        }),
      })
    );
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("예기치 못한 실패는 견적 상세로 연결되는 어드민 알림을 남긴다", async () => {
    mocks.upload.mockRejectedValue(new Error("bucket not found"));

    const res = await POST(request());

    expect(res.status).toBe(500);
    expect(mocks.createNotification).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "SYSTEM",
        title: "견적서 전송 실패",
        content: expect.stringContaining("서버 쏘렌토"),
        linkUrl: "/admin/quotations?id=quote-1&notice=deliver-failed",
      }),
    });
    const payload = mocks.createNotification.mock.calls[0][0].data as {
      content: string;
    };
    expect(payload.content).not.toContain("01012345678");
  });
});

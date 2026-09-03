import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { checkRateLimit, consultRequestRateLimit } from "@/lib/rate-limit";
import { getActiveUser } from "@/lib/require-user";
import { toE164KR } from "@/lib/phone";
import { sendConsultRequestAlimtalk } from "@/lib/consult-request-alimtalk";

// 웹의 여러 상담 진입점(이벤트·차량상세·AI추천 등)이 공유하는 공용 상담 신청 라우트.
// 전화번호를 남긴 고객에게 상담 신청 안내톡을 우리가 먼저 발송한다(카카오 상담톡은
// 고객이 먼저 말을 걸어야 열려 대화방만 열어선 우리가 먼저 응대할 수 없기 때문).
// 비회원도 호출하는 공개 라우트 —
//  · 로그인 세션이 있으면 세션의 번호를 신뢰(클라 번호 무시, 회원 번호 위변조 차단)
//  · 비회원은 body 의 번호 + 개인정보 수집·이용 동의(consent)를 필수로 받는다
//  · IP+번호 기준 rate limit 으로 임의 번호 스팸 발송을 막는다
//  · source 는 상담사 데스크에 남길 유입 경로 라벨(chat_extra)로만 쓴다

// 진입 경로 → 상담사 데스크에 보일 라벨. 미지의 값은 기본 라벨로 접는다(임의 주입 방지).
const SOURCE_LABELS: Record<string, string> = {
  event: "이벤트상담",
  "car-detail": "차량상세",
  recommend: "AI추천",
  "quote-landing": "견적서문의",
};

const bodySchema = z.object({
  phone: z.string().trim().max(20).optional(),
  consent: z.boolean().optional(),
  source: z.string().trim().max(30).optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 본문입니다." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  // 로그인 회원이면 세션의 번호를 쓴다(클라 번호는 신뢰하지 않는다). 없으면 비회원 흐름.
  const member = await getActiveUser();
  const memberPhone = member?.phone && toE164KR(member.phone) ? member.phone : null;

  let phone: string | null;
  if (member && memberPhone) {
    phone = memberPhone;
  } else {
    if (parsed.data.consent !== true) {
      return NextResponse.json(
        { error: "개인정보 수집·이용에 동의해 주세요." },
        { status: 400 },
      );
    }
    phone = parsed.data.phone ?? null;
  }

  const e164 = toE164KR(phone);
  if (!e164) {
    return NextResponse.json(
      { error: "올바른 휴대폰 번호를 입력해 주세요." },
      { status: 400 },
    );
  }

  const limited = await checkRateLimit(request, consultRequestRateLimit, e164);
  if (limited) return limited;

  try {
    const result = await sendConsultRequestAlimtalk({
      phone: phone as string,
      userId: member?.id,
      source: SOURCE_LABELS[parsed.data.source ?? ""] ?? "상담신청",
    });
    if (result.ok) {
      return NextResponse.json({ success: true });
    }
    if (result.reason === "invalid_phone") {
      return NextResponse.json(
        { error: "올바른 휴대폰 번호를 입력해 주세요." },
        { status: 400 },
      );
    }
    // disabled / no_template_code — 템플릿 검수 승인 전 등. 발송 자체가 불가한 상태.
    console.warn(`[public/consult] 안내톡 적재 건너뜀: ${result.reason}`);
    return NextResponse.json(
      { error: "지금은 상담 신청을 받을 수 없어요. 잠시 후 다시 시도해 주세요." },
      { status: 503 },
    );
  } catch (error) {
    console.error("[POST /api/public/consult]", error);
    return NextResponse.json(
      { error: "상담 신청 처리 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}

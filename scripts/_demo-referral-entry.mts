import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

// 추천인 사후입력 배너(D-14)·추천인 카드 UI 검증용 데모 데이터 (로컬 개발 DB 전용).
// - 추천인 쿠폰 정책 2건 (prisma/seed.ts 와 동일 값)
// - 가상 추천인 계정 (코드 K9999)
// - DEV_LOGIN_EMAIL 회원의 profileCompletedAt 을 지금으로 리셋 (창구 열림)
// - 이전 실행의 귀속·쿠폰은 정리해 배너부터 다시 볼 수 있게 한다.
const email = process.env.DEV_LOGIN_EMAIL?.trim();
if (!email) throw new Error("DEV_LOGIN_EMAIL이 .env.local에 필요합니다.");

const policies = [
  {
    code: "REFERRAL_RECEIVED_GIFT_100K",
    trigger: "REFERRAL_RECEIVED",
    title: "추천 가입 감사 상품권",
    description: "계약을 완료하면 지급돼요",
    rewardLabel: "모바일 상품권 10만원",
    rewardAmount: 100000,
    rewardKind: "GIFT",
    termsNote: "계약 완료 후 영업담당자 확인을 거쳐 지급됩니다.",
    validDays: 180,
    displayOrder: 30,
  },
  {
    code: "REFERRAL_GIVEN_GIFT_100K",
    trigger: "REFERRAL_GIVEN",
    title: "추천 감사 상품권",
    description: "추천한 분이 계약을 완료하면 지급돼요",
    rewardLabel: "모바일 상품권 10만원",
    rewardAmount: 100000,
    rewardKind: "GIFT",
    termsNote: "피추천인 계약 완료 후 영업담당자 확인을 거쳐 지급됩니다.",
    validDays: 180,
    displayOrder: 40,
  },
] as const;

for (const policy of policies) {
  await p.couponPolicy.upsert({
    where: { code: policy.code },
    update: {},
    create: policy,
  });
}
console.log("✅ 추천인 쿠폰 정책 2건 확인");

const referrer = await p.user.upsert({
  where: { referralCode: "K9999" },
  update: { isActive: true },
  create: {
    email: "demo-referrer@demo.local",
    name: "홍길동",
    role: "member",
    isActive: true,
    provider: "kakao",
    profileCompleted: true,
    profileCompletedAt: new Date(),
    referralCode: "K9999",
  },
});
console.log("✅ 가상 추천인 준비:", referrer.name, "코드 K9999");

const member = await p.user.findFirst({ where: { email } });
if (!member) {
  throw new Error(`회원 없음: ${email} — /login 에서 개발용 로그인을 먼저 한 번 실행하세요.`);
}

// 이전 검증 실행의 귀속이 남아 있으면 정리해 배너 상태부터 다시 본다.
const existing = await p.referral.findUnique({ where: { refereeId: member.id } });
if (existing) {
  await p.issuedCoupon.deleteMany({ where: { referralId: existing.id } });
  await p.referral.delete({ where: { id: existing.id } });
  console.log("↺ 기존 추천 귀속·쿠폰 정리");
}

await p.user.update({
  where: { id: member.id },
  data: { profileCompleted: true, profileCompletedAt: new Date() },
});
console.log("✅ 회원 창구 리셋 완료:", member.name, "— 지금부터 D-14");

await p.$disconnect();

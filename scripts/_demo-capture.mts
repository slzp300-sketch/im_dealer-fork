// 추천인 UX(사후입력 D-day 배너·추천 귀속 카드) 데모 캡처 스크립트 (로컬 개발 DB 전용).
// 다른 세션과 회원 행 충돌을 피하려면 격리 계정으로 띄운 서버를 상대로 실행한다:
//   nohup env DEV_LOGIN_EMAIL=opencode-demo@demo.local DEV_LOGIN_PASSWORD='demo1234!' pnpm exec next dev -p 3001 &
//   env DEV_LOGIN_EMAIL=opencode-demo@demo.local pnpm exec tsx scripts/_demo-capture.mts
// 결과 스크린샷: 01 배너(D-14) → 02 쿠폰함 입력 → 03 적용 완료 → 04 추천 귀속 카드
import { config } from "dotenv";
config({ path: ".env.local" });
config();
import { createClient } from "@supabase/supabase-js";
import { PrismaClient } from "@prisma/client";
import { chromium } from "@playwright/test";

const BASE = "http://localhost:3001";
const OUT = "/var/folders/4g/kl5xsgzn4dl5ncv00m726jsw0000gn/T/opencode/imdealer-demo";

const p = new PrismaClient();

const policy = {
  code: "REFERRAL_RECEIVED_GIFT_100K",
  trigger: "REFERRAL_RECEIVED" as const,
  title: "추천 가입 감사 상품권",
  description: "계약을 완료하면 지급돼요",
  rewardLabel: "모바일 상품권 10만원",
  rewardAmount: 100000,
  rewardKind: "GIFT" as const,
  termsNote: "계약 완료 후 영업담당자 확인을 거쳐 지급됩니다.",
  validDays: 180,
  displayOrder: 30,
};
await p.couponPolicy.upsert({ where: { code: policy.code }, update: {}, create: policy });
await p.couponPolicy.upsert({
  where: { code: "REFERRAL_GIVEN_GIFT_100K" },
  update: {},
  create: { ...policy, code: "REFERRAL_GIVEN_GIFT_100K", trigger: "REFERRAL_GIVEN", title: "추천 감사 상품권", description: "추천한 분이 계약을 완료하면 지급돼요", termsNote: "피추천인 계약 완료 후 영업담당자 확인을 거쳐 지급됩니다.", displayOrder: 40 },
});

const referrer = await p.user.upsert({
  where: { referralCode: "K8888" },
  update: { isActive: true },
  create: {
    email: "opencode-demo-referrer@demo.local",
    name: "홍길동",
    role: "member",
    isActive: true,
    provider: "kakao",
    profileCompleted: true,
    profileCompletedAt: new Date(),
    referralCode: "K8888",
  },
});

// dev login이 세션으로 쓰는 행(supabaseId 매칭)을 그대로 리셋한다.
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

const login = await page.request.post(`${BASE}/api/dev/login`, { data: {} });
console.log("dev/login:", login.status());

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const email = process.env.DEV_LOGIN_EMAIL?.trim()!;
const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });
const auth = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!auth) throw new Error("auth account not found");
const member = await p.user.findUnique({ where: { supabaseId: auth.id } });
if (!member) throw new Error("member row not found — run dev login once");

const existing = await p.referral.findUnique({ where: { refereeId: member.id } });
if (existing) {
  await p.issuedCoupon.deleteMany({ where: { referralId: existing.id } });
  await p.referral.delete({ where: { id: existing.id } });
}
await p.user.update({
  where: { id: member.id },
  data: { profileCompleted: true, profileCompletedAt: new Date() },
});
console.log("reset ok:", member.id, referrer.name);

await page.goto(`${BASE}/mypage`, { waitUntil: "networkidle" });
await page.waitForSelector("text=추천인 코드 입력까지", { timeout: 30000 });
await page.screenshot({ path: `${OUT}/01-mypage-banner.png`, fullPage: true });
console.log("saved 01");

await page.goto(`${BASE}/mypage/coupons`, { waitUntil: "networkidle" });
await page.waitForSelector("#referral-entry-code", { timeout: 30000 });
await page.screenshot({ path: `${OUT}/02-coupons-entry.png`, fullPage: true });
await page.fill("#referral-entry-code", "K8888");
await page.getByRole("button", { name: "적용하기" }).click();
await page.waitForSelector("text=추천이 적용됐어요", { timeout: 30000 });
await page.waitForTimeout(2200);
await page.screenshot({ path: `${OUT}/03-coupons-applied.png`, fullPage: true });
console.log("saved 02/03");

await page.goto(`${BASE}/mypage`, { waitUntil: "networkidle" });
await page.waitForSelector("text=님의 추천으로 가입하셨어요", { timeout: 30000 });
await page.screenshot({ path: `${OUT}/04-mypage-referred.png`, fullPage: true });
console.log("saved 04");

await browser.close();
await p.$disconnect();

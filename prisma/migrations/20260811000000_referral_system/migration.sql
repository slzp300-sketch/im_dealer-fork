-- 추천인 시스템: Referral 연결, User.referralCode, REFERRAL 쿠폰 트리거,
-- 그리고 IssuedCoupon 중복 발급 제약의 부분 유일 인덱스 전환.
--
-- 이 환경은 셰도우 DB 재생이 불가능해(P3006) `prisma migrate dev` 로 생성할 수 없다.
-- 수기 작성 + `prisma migrate deploy` 로 적용한다. 재실행해도 안전하도록 전 구문에 멱등 가드를 둔다.

-- 1) 추천 상태 enum
DO $$ BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('REWARDED', 'BLOCKED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) 쿠폰 트리거 확장. 새 값은 같은 트랜잭션 안에서 사용할 수 없으므로
--    REFERRAL 정책 INSERT 는 이 파일이 아니라 prisma/seed.ts 가 담당한다.
ALTER TYPE "CouponTrigger" ADD VALUE IF NOT EXISTS 'REFERRAL_RECEIVED';
ALTER TYPE "CouponTrigger" ADD VALUE IF NOT EXISTS 'REFERRAL_GIVEN';

-- 3) 회원 고유 추천 코드
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- 4) 추천 연결. 피추천인은 평생 1회만 귀속된다(refereeId UNIQUE).
CREATE TABLE IF NOT EXISTS "Referral" (
  "id"           TEXT NOT NULL,
  "referrerId"   TEXT NOT NULL,
  "refereeId"    TEXT NOT NULL,
  "code"         TEXT NOT NULL,
  "status"       "ReferralStatus" NOT NULL DEFAULT 'REWARDED',
  -- 원문 IP 는 저장하지 않는다(src/lib/ip-hash.ts 경유 해시만).
  "signupIpHash" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_refereeId_key" ON "Referral"("refereeId");
CREATE INDEX IF NOT EXISTS "Referral_referrerId_createdAt_idx" ON "Referral"("referrerId", "createdAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerId_fkey') THEN
    ALTER TABLE "Referral"
      ADD CONSTRAINT "Referral_referrerId_fkey"
      FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_refereeId_fkey') THEN
    ALTER TABLE "Referral"
      ADD CONSTRAINT "Referral_refereeId_fkey"
      FOREIGN KEY ("refereeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) 추천 보상 쿠폰 ↔ 추천 건 연결
ALTER TABLE "IssuedCoupon" ADD COLUMN IF NOT EXISTS "referralId" TEXT;
CREATE INDEX IF NOT EXISTS "IssuedCoupon_referralId_idx" ON "IssuedCoupon"("referralId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssuedCoupon_referralId_fkey') THEN
    ALTER TABLE "IssuedCoupon"
      ADD CONSTRAINT "IssuedCoupon_referralId_fkey"
      FOREIGN KEY ("referralId") REFERENCES "Referral"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 6) 중복 발급 제약 전환.
--    기존 (userId, policyId) 전면 유니크는 추천인이 두 번째 추천 보상을 받는 것을 막는다.
--    Prisma 스키마는 부분 인덱스를 표현하지 못하므로 여기서 직접 만든다.
--    (a) referralId IS NULL  → SIGNUP/FIRST_CONTRACT 1인 1매 (기존 보장 그대로 유지)
--    (b) referralId NOT NULL → 추천 건 + 정책 조합 1매 (추천인은 추천 건마다 누적 가능)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'IssuedCoupon_userId_policyId_key') THEN
    ALTER TABLE "IssuedCoupon" DROP CONSTRAINT "IssuedCoupon_userId_policyId_key";
  END IF;
END $$;

DROP INDEX IF EXISTS "IssuedCoupon_userId_policyId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "IssuedCoupon_nonreferral_unique"
  ON "IssuedCoupon"("userId", "policyId") WHERE "referralId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "IssuedCoupon_referral_unique"
  ON "IssuedCoupon"("policyId", "referralId") WHERE "referralId" IS NOT NULL;

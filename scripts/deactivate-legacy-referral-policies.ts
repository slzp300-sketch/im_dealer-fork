/**
 * 레거시 추천인 쿠폰 정책(3만원/5만원 캐시백)을 정리한다.
 *
 * 배경: 추천 보상이 "양쪽 모바일 상품권 10만원"으로 확정되면서 새 정책
 * (REFERRAL_RECEIVED_GIFT_100K / REFERRAL_GIVEN_GIFT_100K)이 시드에 추가됐다.
 * 쿠폰 발급은 트리거의 활성 정책 "전부"에 대해 일어나므로, 레거시 정책이 활성으로
 * 남아 있으면 새 정책과 이중 발급된다. 이 스크립트는 레거시 정책을 비활성화하고
 * 그 정책으로 발급된 쿠폰을 삭제한다 (기발급분도 삭제 — 운영 확인 완료).
 *
 * 사용법:
 *   pnpm exec tsx scripts/deactivate-legacy-referral-policies.ts          # dry-run (기본, 쓰기 없음)
 *   pnpm exec tsx scripts/deactivate-legacy-referral-policies.ts --apply  # 실제 DELETE/UPDATE 수행
 *
 * 주의: 새 정책(…_GIFT_100K)은 건드리지 않는다. 새 정책이 아직 없으면 경고만 출력한다
 *       (시드 또는 어드민에서 먼저 생성해야 추천 보상이 발급된다).
 */
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

/** 비활성화 대상 레거시 정책 코드. */
const LEGACY_POLICY_CODES = ["REFERRAL_RECEIVED", "REFERRAL_GIVEN"] as const;
/** 새 정책 코드 (존재 확인용, 변경하지 않음). */
const NEW_POLICY_CODES = [
  "REFERRAL_RECEIVED_GIFT_100K",
  "REFERRAL_GIVEN_GIFT_100K",
] as const;

async function main(): Promise<void> {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const apply = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  try {
    const legacyPolicies = await prisma.couponPolicy.findMany({
      where: { code: { in: [...LEGACY_POLICY_CODES] } },
      select: { id: true, code: true, title: true, rewardLabel: true, isActive: true },
    });
    const legacyPolicyIds = legacyPolicies.map((p) => p.id);

    const legacyCoupons = legacyPolicyIds.length
      ? await prisma.issuedCoupon.groupBy({
          by: ["status"],
          where: { policyId: { in: legacyPolicyIds } },
          _count: { _all: true },
        })
      : [];
    const couponTotal = legacyCoupons.reduce((sum, row) => sum + row._count._all, 0);

    console.log(`모드: ${apply ? "APPLY (DB 쓰기)" : "DRY-RUN (쓰기 없음)"}`);
    console.log("── 레거시 정책 ───────────────────────────");
    if (legacyPolicies.length === 0) console.log("레거시 정책 없음. 변경할 대상 없음.");
    for (const p of legacyPolicies) {
      console.log(
        `  · ${p.code} "${p.title}" (${p.rewardLabel}) — ${p.isActive ? "활성" : "이미 비활성"}`,
      );
    }
    console.log("── 레거시 정책 발급 쿠폰 ───────────────────");
    console.log(`총 ${couponTotal}건`);
    for (const row of legacyCoupons) {
      console.log(`  · ${row.status}: ${row._count._all}건`);
    }

    if (legacyPolicies.length === 0 && couponTotal === 0) return;

    if (!apply) {
      console.log("\nDRY-RUN 종료. 실제 반영하려면 --apply 를 붙여 다시 실행한다.");
      return;
    }

    if (legacyPolicyIds.length > 0) {
      const deleted = await prisma.issuedCoupon.deleteMany({
        where: { policyId: { in: legacyPolicyIds } },
      });
      console.log(`\n[APPLY] 레거시 쿠폰 삭제: ${deleted.count}건`);

      const deactivated = await prisma.couponPolicy.updateMany({
        where: { id: { in: legacyPolicyIds }, isActive: true },
        data: { isActive: false },
      });
      console.log(`[APPLY] 레거시 정책 비활성화: ${deactivated.count}건`);
    }

    const activeReferralPolicies = await prisma.couponPolicy.findMany({
      where: { trigger: { in: ["REFERRAL_RECEIVED", "REFERRAL_GIVEN"] }, isActive: true },
      select: { code: true, title: true, rewardLabel: true },
    });
    console.log("\n── 정리 후 활성 추천 정책 ──────────────────");
    for (const p of activeReferralPolicies) {
      console.log(`  · ${p.code} "${p.title}" (${p.rewardLabel})`);
    }
    const activeCodes = new Set(activeReferralPolicies.map((p) => p.code));
    const missing = NEW_POLICY_CODES.filter((code) => !activeCodes.has(code));
    if (missing.length > 0) {
      console.log(`\n⚠️ 새 정책이 없다: ${missing.join(", ")} — 시드 또는 어드민에서 생성할 것.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(argv: readonly string[]): boolean {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else throw new Error(`알 수 없는 인자: ${arg} (사용 가능: --apply, --dry-run)`);
  }
  return apply;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

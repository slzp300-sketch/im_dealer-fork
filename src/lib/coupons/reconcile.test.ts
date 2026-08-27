import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findPolicies: vi.fn(),
  findCoupons: vi.fn(),
  findConvertedQuote: vi.fn(),
  findRefereeQuotes: vi.fn(),
  createManyCoupons: vi.fn(),
  updateManyCoupons: vi.fn(),
  findUniqueUser: vi.fn(),
  findUniqueReferral: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    couponPolicy: { findMany: mocks.findPolicies },
    issuedCoupon: {
      findMany: mocks.findCoupons,
      createMany: mocks.createManyCoupons,
      updateMany: mocks.updateManyCoupons,
    },
    savedQuote: { findFirst: mocks.findConvertedQuote, findMany: mocks.findRefereeQuotes },
    user: { findUnique: mocks.findUniqueUser },
    referral: { findUnique: mocks.findUniqueReferral },
  },
}));

import { reconcileCouponsForQuoteOwner, reconcileUserCoupons } from "./reconcile";

const TARGET = { id: "user-1", supabaseId: "sb-1", profileCompleted: true };

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.findPolicies.mockResolvedValue([]);
  mocks.findCoupons.mockResolvedValue([]);
  mocks.findConvertedQuote.mockResolvedValue(null);
  mocks.findRefereeQuotes.mockResolvedValue([]);
  mocks.createManyCoupons.mockResolvedValue({ count: 0 });
  mocks.updateManyCoupons.mockResolvedValue({ count: 0 });
  mocks.findUniqueUser.mockResolvedValue(null);
  mocks.findUniqueReferral.mockResolvedValue(null);
});

describe("reconcileUserCoupons", () => {

  it("계약 조회는 supabaseId 로, 쿠폰 조회는 User.id 로 한다", async () => {
    await reconcileUserCoupons(TARGET);

    expect(mocks.findConvertedQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "sb-1", status: "CONVERTED", deletedAt: null },
      })
    );
    expect(mocks.findCoupons).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1" } })
    );
  });

  it("발급 대상이 있으면 skipDuplicates 로 생성한다", async () => {
    mocks.findPolicies.mockResolvedValue([
      {
        id: "policy-signup",
        trigger: "SIGNUP",
        title: "첫가입 축하 주유권",
        rewardLabel: "주유권 10만원",
        rewardAmount: 100_000,
        validDays: 90,
        isActive: true,
        startsAt: null,
        endsAt: null,
      },
    ]);

    await reconcileUserCoupons(TARGET);

    expect(mocks.createManyCoupons).toHaveBeenCalledTimes(1);
    const arg = mocks.createManyCoupons.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data[0]).toMatchObject({
      userId: "user-1",
      policyId: "policy-signup",
      status: "HELD",
      titleSnapshot: "첫가입 축하 주유권",
      rewardAmountSnapshot: 100_000,
    });
    expect(arg.data[0].code).toMatch(/^AD-[A-Z2-9]{6}$/);
  });

  it("발급·전이 대상이 없으면 쓰기를 하지 않는다", async () => {
    await reconcileUserCoupons(TARGET);

    expect(mocks.createManyCoupons).not.toHaveBeenCalled();
    expect(mocks.updateManyCoupons).not.toHaveBeenCalled();
  });

  it("계약이 있으면 보유 중인 HELD 를 PENDING 으로 올린다", async () => {
    mocks.findConvertedQuote.mockResolvedValue({ id: "quote-9" });
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-1",
        policyId: "policy-signup",
        status: "HELD",
        expiresAt: null,
        policy: { trigger: "SIGNUP" },
        referral: null,
      },
    ]);

    await reconcileUserCoupons(TARGET);

    // 계획이 세워질 당시 HELD 였던 쿠폰만 건드린다. 그 사이 다른 상태로 바뀌었으면
    // (예: 어드민이 PAID 처리) 이 쓰기가 손대면 안 된다.
    expect(mocks.updateManyCoupons).toHaveBeenCalledWith({
      where: { id: { in: ["coupon-1"] }, status: "HELD" },
      data: { status: "PENDING", qualifiedQuoteId: "quote-9", qualifiedAt: expect.any(Date) },
    });
  });

  it("계약이 철회되면 PENDING 을 HELD 로 되돌린다 (status: PENDING 조건 포함)", async () => {
    mocks.findConvertedQuote.mockResolvedValue(null);
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-2",
        policyId: "policy-contract",
        status: "PENDING",
        expiresAt: null,
        policy: { trigger: "FIRST_CONTRACT" },
        referral: null,
      },
    ]);

    await reconcileUserCoupons(TARGET);

    // reconcileUserCoupons 를 실제로 통과시켜 unqualify 쓰기가 발생하는지까지 확인한다.
    // status 예측만 검증하면 이 쓰기 경로 자체가 한 번도 실행되지 않아도 테스트가 통과한다.
    expect(mocks.updateManyCoupons).toHaveBeenCalledWith({
      where: { id: { in: ["coupon-2"] }, status: "PENDING" },
      data: { status: "HELD", qualifiedQuoteId: null, qualifiedAt: null },
    });
  });

  it("만료일이 지난 HELD 를 EXPIRED 로 바꾼다 (status: HELD 조건 포함)", async () => {
    mocks.findConvertedQuote.mockResolvedValue(null);
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-3",
        policyId: "policy-signup",
        status: "HELD",
        expiresAt: new Date("2000-01-01T00:00:00.000Z"),
        policy: { trigger: "SIGNUP" },
        referral: null,
      },
    ]);

    await reconcileUserCoupons(TARGET);

    // 위와 마찬가지로 expire 쓰기 경로가 실제로 호출되는지를 목 상태 조합으로 구동해 확인한다.
    expect(mocks.updateManyCoupons).toHaveBeenCalledWith({
      where: { id: { in: ["coupon-3"] }, status: "HELD" },
      data: { status: "EXPIRED" },
    });
  });

  it("추천인 쿠폰은 피추천인 계약을 조회해 지급 대상으로 올린다", async () => {
    mocks.findConvertedQuote.mockResolvedValue(null);
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-given",
        policyId: "policy-given",
        status: "HELD",
        expiresAt: null,
        policy: { trigger: "REFERRAL_GIVEN" },
        referral: { referee: { supabaseId: "sb-friend" } },
      },
    ]);
    mocks.findRefereeQuotes.mockResolvedValue([
      { id: "friend-quote", userId: "sb-friend" },
    ]);

    await reconcileUserCoupons(TARGET);

    expect(mocks.findRefereeQuotes).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: { in: ["sb-friend"] }, status: "CONVERTED", deletedAt: null },
      })
    );
    expect(mocks.updateManyCoupons).toHaveBeenCalledWith({
      where: { id: { in: ["coupon-given"] }, status: "HELD" },
      data: {
        status: "PENDING",
        qualifiedQuoteId: "friend-quote",
        qualifiedAt: expect.any(Date),
      },
    });
  });

  it("추천인 쿠폰은 본인 계약만으로는 올리지 않는다", async () => {
    mocks.findConvertedQuote.mockResolvedValue({ id: "quote-own" });
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-given",
        policyId: "policy-given",
        status: "HELD",
        expiresAt: null,
        policy: { trigger: "REFERRAL_GIVEN" },
        referral: { referee: { supabaseId: "sb-friend" } },
      },
    ]);
    mocks.findRefereeQuotes.mockResolvedValue([]);

    await reconcileUserCoupons(TARGET);

    expect(mocks.updateManyCoupons).not.toHaveBeenCalled();
  });

  it("추천인 쿠폰이 없으면 피추천인 계약 조회를 생략한다", async () => {
    mocks.findCoupons.mockResolvedValue([
      {
        id: "coupon-1",
        policyId: "policy-signup",
        status: "HELD",
        expiresAt: null,
        policy: { trigger: "SIGNUP" },
        referral: null,
      },
    ]);

    await reconcileUserCoupons(TARGET);

    expect(mocks.findRefereeQuotes).not.toHaveBeenCalled();
  });

  it("전달받은 트랜잭션 클라이언트를 쓴다", async () => {
    const tx = {
      couponPolicy: { findMany: vi.fn().mockResolvedValue([]) },
      issuedCoupon: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
        updateMany: vi.fn(),
      },
      savedQuote: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await reconcileUserCoupons(TARGET, tx as never);

    expect(tx.savedQuote.findFirst).toHaveBeenCalled();
    expect(mocks.findConvertedQuote).not.toHaveBeenCalled();
  });
});

// 어드민이 견적을 CONVERTED 로/에서 전환할 때 부르는 훅. where 절을 supabaseId 에서
// id 로 잘못 바꾸면 타입은 그대로 통과하고 findUnique 가 null 을 반환해 조용히
// 죽으므로, 정확한 where 절과 동기화 대상 인자를 못박는다.
describe("reconcileCouponsForQuoteOwner", () => {
  it("supabaseId 로 회원을 조회하고 본인 쿠폰을 동기화한다", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-user-1",
      profileCompleted: true,
    });

    await reconcileCouponsForQuoteOwner("sb-user-1");

    expect(mocks.findUniqueUser).toHaveBeenCalledWith({
      where: { supabaseId: "sb-user-1" },
      select: { id: true, supabaseId: true, profileCompleted: true },
    });
    expect(mocks.findCoupons).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "member-1" } })
    );
  });

  it("추천으로 가입한 회원이면 추천인 쿠폰도 함께 동기화한다", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-user-1",
      profileCompleted: true,
    });
    mocks.findUniqueReferral.mockResolvedValue({
      referrer: {
        id: "referrer-1",
        supabaseId: "sb-referrer-1",
        profileCompleted: true,
      },
    });

    await reconcileCouponsForQuoteOwner("sb-user-1");

    expect(mocks.findUniqueReferral).toHaveBeenCalledWith({
      where: { refereeId: "member-1" },
      select: {
        referrer: {
          select: { id: true, supabaseId: true, profileCompleted: true },
        },
      },
    });
    const couponQueryUserIds = mocks.findCoupons.mock.calls.map(
      (call) => call[0].where.userId
    );
    expect(couponQueryUserIds).toEqual(["member-1", "referrer-1"]);
  });

  it("회원을 찾지 못하면 아무것도 하지 않는다", async () => {
    await reconcileCouponsForQuoteOwner("sb-ghost");

    expect(mocks.findCoupons).not.toHaveBeenCalled();
    expect(mocks.findUniqueReferral).not.toHaveBeenCalled();
  });

  it("추천이 없으면 소유자만 동기화한다", async () => {
    mocks.findUniqueUser.mockResolvedValue({
      id: "member-1",
      supabaseId: "sb-user-1",
      profileCompleted: true,
    });

    await reconcileCouponsForQuoteOwner("sb-user-1");

    expect(mocks.findCoupons).toHaveBeenCalledTimes(1);
  });
});

// T19: IssuedCoupon 복합 유니크. 유니크는 DB 부분 유니크 2개로 존재하므로
// (1) 배포본(마이그레이션 SQL·스키마)이 그 계약을 유지하는지, (2) 발급 경로가
// 유니크+skipDuplicates 로 경쟁을 이기는지를 검증한다.
describe("IssuedCoupon 복합 유니크 정합 (T19)", () => {
  // vitest 루트(레포 최상위) 기준 경로.
  const repoRoot = process.cwd();
  const migrationsDir = join(repoRoot, "prisma", "migrations");
  // 부분 유니크는 08-11 추천 시스템 마이그레이션이 처음 만들고, 08-19 정합
  // 마이그레이션이 프로덕션 실측 모양으로 재선언한다. 정합 쪽이 단일 진실 공급원.
  const REFERRAL_MIGRATION = "20260811000000_referral_system";
  const PARTIAL_UNIQUES_MIGRATION = "20260819000000_issued_coupon_partial_uniques";

  function readAllMigrations(): { dir: string; sql: string }[] {
    return readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        dir: entry.name,
        sql: readFileSync(join(migrationsDir, entry.name, "migration.sql"), "utf8"),
      }))
      .sort((a, b) => a.dir.localeCompare(b.dir));
  }

  function readMigration(dir: string): string {
    return readFileSync(join(migrationsDir, dir, "migration.sql"), "utf8");
  }

  it("부분 유니크는 추천 시스템·정합 두 마이그레이션에 걸쳐 존재한다", () => {
    const owners = readAllMigrations()
      .filter((m) => m.sql.includes("IssuedCoupon_nonreferral_unique"))
      .map((m) => m.dir);

    expect(owners).toEqual([REFERRAL_MIGRATION, PARTIAL_UNIQUES_MIGRATION]);
  });

  it("정합 마이그레이션(08-19)은 두 부분 유니크를 만들고 레거시 풀 유니크를 제거한다", () => {
    const sql = readMigration(PARTIAL_UNIQUES_MIGRATION);

    // 비추천 쿠폰: 회원×정책 1장 (reconcile 경로 전부)
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"IssuedCoupon_nonreferral_unique"[\s\S]*WHERE\s+"referralId"\s+IS\s+NULL/
    );
    // 추천 쿠폰: 정책×추천건 1장 (apply 경로 전부 — 추천인은 피추천인마다 발급된다)
    expect(sql).toMatch(
      /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+"IssuedCoupon_referral_unique"[\s\S]*WHERE\s+"referralId"\s+IS\s+NOT\s+NULL/
    );
    // add_coupon_box 가 만든 풀 유니크는 REFERRAL_GIVEN 다중 보유와 충돌하므로 제거한다.
    expect(sql).toContain('DROP INDEX IF EXISTS "IssuedCoupon_userId_policyId_key"');
  });

  it("정합 마이그레이션(08-19)은 유니크 생성 전에 중복 낙오 행을 삭제 정리한다", () => {
    // 08-11 추천 시스템 마이그레이션엔 낙오 정리 단계가 없으므로, 이 검증은 반드시
    // 정합 마이그레이션 파일을 직접 읽어야 한다.
    const sql = readMigration(PARTIAL_UNIQUES_MIGRATION);

    // 중복 제거가 먼저 오고 유니크 생성이 나중에 와야 색인 생성이 실패하지 않는다.
    // 부분 유니크는 상태와 무관하게 키를 점유하므로, 폐기(REVOKED)가 아니라
    // 삭제로 낙오 행을 키에서 내보내야만 색인이 만들어진다.
    const dedupIndex = sql.search(/DELETE FROM "IssuedCoupon"/);
    const uniqueIndex = sql.search(/CREATE\s+UNIQUE\s+INDEX[^;]*"IssuedCoupon_nonreferral_unique"/);
    expect(dedupIndex).toBeGreaterThan(-1);
    expect(uniqueIndex).toBeGreaterThan(dedupIndex);
    // 보관 행 우선순위: 이미 지급된 PAID 는 낙오에서 제외한다.
    expect(sql).toMatch(/ORDER BY \(status = 'PAID'\) DESC/);
  });

  it("스키마는 REFERRAL_GIVEN 다중 발급과 충돌하는 풀 유니크를 선언하지 않는다", () => {
    const schema = readFileSync(join(repoRoot, "prisma", "schema.prisma"), "utf8");
    // 주석(문서화)은 허용되고 선언만 금지한다.
    const declarationsOnly = schema
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    // @@unique([userId, policyId]) 전역 유니크는 추천인이 같은 정책으로
    // 피추천인마다 쿠폰을 받는 구조(월 상한 10건)와 양립하지 않는다.
    expect(declarationsOnly).not.toContain("@@unique([userId, policyId])");
  });
});

// 2탭 동시 reconcile 경쟁: 두 탭 모두 "쿠폰 없음" 스냅숏을 보고 발급을 시도한다.
// 최종 1장 보장은 DB 부분 유니크 + skipDuplicates(ON CONFLICT DO NOTHING) 의 조합이며,
// 이 테스트는 저장소가 그 유니크를 강제할 때 reconcile 의 쓰기가 수렴함을 못박는다.
describe("동시 reconcile 경쟁 (T19)", () => {
  type StoredRow = {
    userId: string;
    policyId: string;
    referralId: string | null;
  };

  function makeRaceTabDb(rows: StoredRow[], snapshotCoupons: unknown[]) {
    return {
      couponPolicy: {
        findMany: async () => [
          {
            id: "policy-signup",
            trigger: "SIGNUP",
            title: "첫가입 축하 주유권",
            rewardLabel: "주유권 10만원",
            rewardAmount: 100_000,
            validDays: 90,
            isActive: true,
            startsAt: null,
            endsAt: null,
          },
          {
            id: "policy-given",
            trigger: "REFERRAL_GIVEN",
            title: "추천인 축하금",
            rewardLabel: "축하금 10만원",
            rewardAmount: 100_000,
            validDays: null,
            isActive: true,
            startsAt: null,
            endsAt: null,
          },
        ],
      },
      issuedCoupon: {
        findMany: async () => snapshotCoupons,
        createMany: async (args: {
          data: StoredRow[];
          skipDuplicates?: boolean;
        }) => {
          for (const row of args.data) {
            // reconcile 발급 행은 referralId 필드를 아예 안 넘긴다(컬럼 기본값 NULL).
            // 저장소에서는 NULL 로 정규화해 DB 와 동일하게 취급한다.
            const referralId = row.referralId ?? null;
            const conflicts = rows.some(
              (existing) =>
                existing.referralId === null &&
                referralId === null &&
                existing.userId === row.userId &&
                existing.policyId === row.policyId
            );
            if (conflicts) {
              if (!args.skipDuplicates) {
                throw new Error(
                  "Unique constraint failed: IssuedCoupon_nonreferral_unique"
                );
              }
              continue;
            }
            rows.push({ ...row, referralId });
          }
          return { count: args.data.length };
        },
        updateMany: async () => ({ count: 0 }),
      },
      savedQuote: { findFirst: async () => null },
    };
  }

  it("같은 스냅숏으로 경쟁해도 SIGNUP 쿠폰은 정확히 1장 발급된다", async () => {
    const rows: StoredRow[] = [];

    // 두 탭 모두 빈 쿠폰함을 본 시점의 스냅숏으로 발급을 시도한다(경쟁).
    await reconcileUserCoupons(
      TARGET,
      makeRaceTabDb(rows, []) as never
    );
    await reconcileUserCoupons(
      TARGET,
      makeRaceTabDb(rows, []) as never
    );

    const signup = rows.filter((row) => row.policyId === "policy-signup");
    expect(signup).toHaveLength(1);
    expect(signup[0]).toMatchObject({
      userId: "user-1",
      policyId: "policy-signup",
      referralId: null,
    });
  });

  it("REFERRAL_* 정책은 reconcile 발급 경로에서 만들지 않는다", async () => {
    const rows: StoredRow[] = [];

    await reconcileUserCoupons(
      TARGET,
      makeRaceTabDb(rows, []) as never
    );

    expect(rows.filter((row) => row.policyId === "policy-given")).toHaveLength(0);
  });
});

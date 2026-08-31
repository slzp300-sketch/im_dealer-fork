import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/worker-auth";
import { resolveCapitalConnection } from "@/lib/scraper/connections";
import { buildClaimLeaseWhere, buildClaimWorkerWhere, getClaimWorkerId } from "@/lib/scraper/job-state";
import {
  SCRAPE_JOB_MAX_AGE_MS,
  SCRAPE_JOB_STALE_HEARTBEAT_MS,
} from "@/lib/scraper/credential-retention";
import { markNamedWorkerSeen, markWorkerSeen } from "@/lib/scraper/worker-presence";
import { WORKER_PROTOCOL_VERSION } from "@/lib/scraper/worker-version";

const STALE_MS = SCRAPE_JOB_STALE_HEARTBEAT_MS; // 하트비트 3분 초과 시 워커가 죽은 것으로 보고 재클레임

// POST /api/worker/scrape-jobs/claim — 대기 작업 1건을 원자적으로 클레임
// 반환 자격증명은 암호문 그대로. 복호화는 워커가 자신의 PII_ENCRYPTION_KEY 로 로컬 수행.
export async function POST(request: NextRequest) {
  const { error } = requireWorker(request);
  if (error) return error;

  // 워커가 유휴 상태일 때도 이 라우트를 주기적으로 호출하므로, 여기서 생존 신호를 남긴다.
  // 실패해도 클레임 자체를 막지 않는다(상태 표시는 부가 기능).
  await markWorkerSeen().catch(() => undefined);
  const claimWorkerId = getClaimWorkerId(request);
  if (claimWorkerId) await markNamedWorkerSeen(claimWorkerId).catch(() => undefined);

  const workerProtocolVersion = request.headers.get("x-worker-protocol-version");
  if (workerProtocolVersion === null) {
    // 기존 v2 클라이언트는 409 본문을 읽지 못하지만 성공 응답의 기대 버전은 처리한다.
    return NextResponse.json({ job: null, expectedWorkerVersion: WORKER_PROTOCOL_VERSION });
  }
  if (workerProtocolVersion !== String(WORKER_PROTOCOL_VERSION)) {
    return NextResponse.json(
      {
        error: "worker_protocol_version_incompatible",
        expectedWorkerVersion: WORKER_PROTOCOL_VERSION,
        receivedWorkerVersion: workerProtocolVersion,
      },
      { status: 409 }
    );
  }

  try {
    const db = prisma;
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - STALE_MS);

    // pending 우선, 없으면 하트비트가 끊긴 running/needs_human(=죽은 워커) 회수.
    // workerId 가 지정된 작업은 그 워커만 집는다 — 남의 캐피탈 계정이 내 PC 에서
    // 복호화·로그인되는 일을 막는다. 지정이 없으면 아무 워커나 집는다(기존 동작).
    const candidate = await db.scrapeJob.findFirst({
      where: {
        AND: [
          buildClaimWorkerWhere(claimWorkerId),
          {
            OR: [
              { status: "pending" },
              { status: { in: ["running", "needs_human"] }, heartbeatAt: { lt: staleCutoff } },
            ],
          },
        ],
      },
      orderBy: { createdAt: "asc" },
    });
    // 작업 유무와 무관하게 기대 버전을 실어, 실행 중에 백엔드가 배포돼도 워커가 알아챈다.
    if (!candidate) {
      return NextResponse.json({ job: null, expectedWorkerVersion: WORKER_PROTOCOL_VERSION });
    }

    // 이중 클레임 방지: 후보의 현재 상태를 조건으로 건 updateMany 가 정확히 1건일 때만 성공
    const leaseToken = randomUUID();
    const claimed = await db.scrapeJob.updateMany({
      where: buildClaimLeaseWhere(candidate, staleCutoff),
      data: { status: "running", claimedAt: now, heartbeatAt: now, leaseToken },
    });
    if (claimed.count !== 1) {
      // 다른 워커가 먼저 가져감 — 다음 폴링에서 재시도
      return NextResponse.json({ job: null });
    }

    // 등록 후 하루가 지난 작업은 실행하지 않고 폐기한다. 사람 로그인 캐피탈사는
    // 자격증명을 저장하지 않아 아래 자격증명 만료를 타지 않으므로, 테스트하다 잊힌
    // 작업이 몇 주 뒤 접속한 워커의 브라우저를 붙잡는 일이 여기서 끊긴다.
    const jobExpiryCutoff = new Date(now.getTime() - SCRAPE_JOB_MAX_AGE_MS);
    if (candidate.createdAt && candidate.createdAt <= jobExpiryCutoff) {
      await db.scrapeJob.updateMany({
        where: { id: candidate.id, status: "running", leaseToken },
        data: {
          status: "failed",
          error: "등록 후 24시간이 지나 자동 만료",
          finishedAt: new Date(),
          credUsernameEnc: null,
          credPasswordEnc: null,
          leaseToken: null,
        },
      });
      return NextResponse.json({ job: null, expectedWorkerVersion: WORKER_PROTOCOL_VERSION });
    }

    // 크론 실행 시점 사이에 만료된 자동 로그인 암호문을 다시 워커로
    // 전달하지 않는다. 이력 행은 남기되 자격증명만 즉시 폐기한다.
    if (candidate.credentialExpiresAt && candidate.credentialExpiresAt <= now) {
      await db.scrapeJob.updateMany({
        where: { id: candidate.id, status: "running", leaseToken },
        data: {
          status: "failed",
          error: "로그인 정보 보관 기간 만료",
          finishedAt: new Date(),
          credUsernameEnc: null,
          credPasswordEnc: null,
          leaseToken: null,
        },
      });
      return NextResponse.json({ job: null });
    }

    // 로그인 URL·어댑터는 코드 내장, ID/PW 암호문은 작업에 임시 저장된 것을 사용
    const fc = await prisma.financeCompany.findUnique({
      where: { id: candidate.financeCompanyId },
      select: { name: true },
    });
    const connection = fc ? resolveCapitalConnection(fc.name) : null;
    // requiresHuman 캐피탈사는 어댑터가 자격증명을 쓰지 않으므로 애초에 저장하지 않는다.
    // 그런 곳까지 "로그인 정보 없음"으로 실패시키면 안 된다.
    const needsCredentials = connection !== null && !connection.requiresHuman;
    const credentialsMissing =
      needsCredentials && (!candidate.credUsernameEnc || !candidate.credPasswordEnc);

    if (!connection || credentialsMissing) {
      // 접속 설정이 없거나, 필요한데 임시 자격증명이 사라짐 → 작업 실패 처리
      await db.scrapeJob.updateMany({
        where: { id: candidate.id, status: "running", leaseToken },
        data: {
          status: "failed",
          error: connection ? "로그인 정보 없음" : "지원하지 않는 캐피탈사",
          finishedAt: new Date(),
          credUsernameEnc: null,
          credPasswordEnc: null,
          leaseToken: null,
        },
      });
      return NextResponse.json({ job: null });
    }

    return NextResponse.json({
      expectedWorkerVersion: WORKER_PROTOCOL_VERSION,
      job: {
        id: candidate.id,
        leaseToken,
        financeCompanyId: candidate.financeCompanyId,
        jobType: candidate.jobType ?? "trim_rates",
        productType: candidate.productType,
        params: candidate.params,
      },
      credential: {
        loginUrl: connection.loginUrl,
        usernameEnc: candidate.credUsernameEnc ?? "",
        passwordEnc: candidate.credPasswordEnc ?? "",
        config: { adapter: connection.adapter },
        requiresHuman: connection.requiresHuman,
      },
    });
  } catch (e) {
    console.error("[worker claim]", e);
    return NextResponse.json({ error: "클레임 실패" }, { status: 500 });
  }
}

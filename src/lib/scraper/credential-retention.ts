import { prisma } from "@/lib/prisma";

/**
 * Automatic-login credentials are intentionally short-lived. 24 hours covers
 * a normal catalog collection (including an overnight/manual handoff) while
 * bounding the exposure window when a job is abandoned.
 */
export const SCRAPE_CREDENTIAL_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Keep this aligned with the worker's stale-lease reclaim threshold. */
export const SCRAPE_JOB_STALE_HEARTBEAT_MS = 3 * 60 * 1000;

/**
 * A job that sat unfinished for a full day is stale work nobody is waiting on.
 * Claiming it late hijacks whichever worker comes online next (human-login
 * capitals never hit the credential expiry above because they store none), so
 * the claim route discards such jobs instead of handing them out.
 */
export const SCRAPE_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const ACTIVE_SCRAPE_JOB_STATUSES = ["running", "needs_human"] as const;
const INACTIVE_SCRAPE_JOB_STATUSES = ["pending", "completed", "failed", "canceled"] as const;

export function getScrapeCredentialExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SCRAPE_CREDENTIAL_RETENTION_MS);
}

/**
 * Match only expired credentials on jobs that are no longer actively claimed.
 * The job row, result draft, status, and timestamps are deliberately not part
 * of the update data so terminal audit metadata remains intact.
 */
export function buildScrapeCredentialPurgeWhere(now = new Date()) {
  const staleHeartbeatCutoff = new Date(now.getTime() - SCRAPE_JOB_STALE_HEARTBEAT_MS);

  return {
    credentialExpiresAt: { lte: now },
    AND: [
      {
        OR: [
          { credUsernameEnc: { not: null } },
          { credPasswordEnc: { not: null } },
        ],
      },
    ],
    OR: [
      // A completed/failed legacy job may still contain ciphertext created
      // before result handlers began clearing it. Keep the audit row, but
      // purge the expired ciphertext just like a pending job.
      { status: { in: [...INACTIVE_SCRAPE_JOB_STATUSES] } },
      {
        status: { in: [...ACTIVE_SCRAPE_JOB_STATUSES] },
        OR: [
          { heartbeatAt: null },
          { heartbeatAt: { lt: staleHeartbeatCutoff } },
        ],
      },
    ],
  };
}

export async function purgeExpiredScrapeJobCredentials(now = new Date()) {
  return prisma.scrapeJob.updateMany({
    where: buildScrapeCredentialPurgeWhere(now),
    data: {
      credUsernameEnc: null,
      credPasswordEnc: null,
    },
  });
}

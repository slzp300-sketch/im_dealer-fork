import * as Sentry from "@sentry/nextjs";
import type { NextRequest } from "next/server";
import type { User } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { getTrustedClientIp } from "@/lib/client-ip";
import { hashIp } from "@/lib/ip-hash";
import { prisma } from "@/lib/prisma";

export const VEHICLE_IMAGE_AUDIT_ACTIONS = [
  "VEHICLE_IMAGE_CREATE",
  "VEHICLE_IMAGE_UPDATE",
  "VEHICLE_IMAGE_VISIBILITY",
  "VEHICLE_IMAGE_REORDER",
  "VEHICLE_IMAGE_SET_REPRESENTATIVE",
  "VEHICLE_IMAGE_DELETE",
  "VEHICLE_IMAGE_RESTORE",
  "VEHICLE_IMAGE_PURGE",
] as const;

export const VERIFICATION_AUDIT_ACTIONS = [
  "VERIFICATION_DETAIL_VIEW",
  "VERIFICATION_DOCUMENT_DOWNLOAD",
] as const;

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "LOGIN_FAILED"
  | "VEHICLE_CREATE"
  | "VEHICLE_UPDATE"
  | "VEHICLE_DELETE"
  | "VEHICLE_REORDER"
  | (typeof VEHICLE_IMAGE_AUDIT_ACTIONS)[number]
  | (typeof VERIFICATION_AUDIT_ACTIONS)[number]
  | "TRIM_CREATE"
  | "TRIM_UPDATE"
  | "TRIM_DELETE"
  | "TRIM_BULK_DISCOUNT"
  | "TRIM_BULK_SUBSIDY"
  | "OPTION_CREATE"
  | "OPTION_UPDATE"
  | "OPTION_DELETE"
  | "OPTION_REORDER"
  | "OPTION_BADGE_CREATE"
  | "OPTION_BADGE_UPDATE"
  | "OPTION_BADGE_DELETE"
  | "VEHICLE_OPTION_BADGE_SET"
  | "VEHICLE_OPTION_BADGE_UNSET"
  | "VEHICLE_COLOR_CREATE"
  | "VEHICLE_COLOR_UPDATE"
  | "VEHICLE_COLOR_DELETE"
  | "REVIEW_CREATE"
  | "REVIEW_UPDATE"
  | "REVIEW_DELETE"
  | "REVIEW_TOKEN_ISSUE"
  | "REVIEW_TOKEN_REVOKE"
  | "RATE_SHEET_CREATE"
  | "RATE_SHEET_UPDATE"
  | "RATE_SHEET_DELETE"
  | "FINANCE_COMPANY_CREATE"
  | "FINANCE_COMPANY_UPDATE"
  | "FINANCE_COMPANY_DELETE"
  | "INVENTORY_CREATE"
  | "INVENTORY_UPDATE"
  | "INVENTORY_DELETE"
  | "IMMEDIATE_DELIVERY_UPLOAD"
  | "IMMEDIATE_DELIVERY_DELETE"
  | "IMMEDIATE_DELIVERY_SHEET_SYNC"
  | "QUOTE_UPDATE"
  | "QUOTE_DELETE"
  | "QUOTE_DELIVERY_MANUAL_SEND"
  | "BRAND_CREATE"
  | "BRAND_UPDATE"
  | "BRAND_DELETE"
  | "ACCOUNT_CREATE"
  | "ACCOUNT_UPDATE"
  | "ACCOUNT_DELETE"
  | "POLICY_UPDATE"
  | "AI_CONFIG_UPDATE"
  | "POPULAR_CONFIG_CREATE"
  | "POPULAR_CONFIG_UPDATE"
  | "POPULAR_CONFIG_DELETE"
  | "LINEUP_CREATE"
  | "LINEUP_UPDATE"
  | "LINEUP_DELETE"
  | "RULE_CREATE"
  | "RULE_UPDATE"
  | "RULE_DELETE"
  | "NOTIFICATION_CREATE"
  | "NOTIFICATION_UPDATE"
  | "NOTIFICATION_DELETE"
  | "SCRAPE_JOB_CREATE"
  | "SCRAPE_JOB_CANCEL"
  | "SCRAPE_JOB_RESUME"
  | "CATALOG_MAPPING_UPSERT"
  | "CATALOG_MAPPING_DELETE"
  | "RATE_SHEET_APPLY_CATALOG"
  | "COUPON_POLICY_CREATE"
  | "COUPON_POLICY_UPDATE"
  | "COUPON_POLICY_DELETE"
  | "COUPON_PAID"
  | "COUPON_REVOKED"
  | "REFERRAL_UNBLOCKED"
  | "REFERRAL_REVOKED"
  | "MEMO_CREATE"
  | "MEMO_UPDATE"
  | "MEMO_DELETE"
  | "FILE_UPLOAD";

export type AuditActor = Pick<User, "id"> & { email: string | null };

interface LogAdminActionParams {
  request?: NextRequest | Request | null;
  actor: AuditActor;
  action: AuditAction;
  resource: string;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
}

function extractIp(request?: NextRequest | Request | null): string | null {
  if (!request) return null;
  // IP 추출 단일 정책(src/lib/client-ip) 적용 — TRUST_PROXY/VERCEL 검사 포함.
  return getTrustedClientIp(request.headers);
}

function extractUserAgent(request?: NextRequest | Request | null): string | null {
  if (!request) return null;
  return request.headers.get("user-agent");
}

function buildDiff(
  before: unknown,
  after: unknown,
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  if (before !== undefined) payload.before = before;
  if (after !== undefined) payload.after = after;
  if (meta && Object.keys(meta).length > 0) payload.meta = meta;
  return Object.keys(payload).length > 0 ? payload : null;
}

export async function logAdminAction(params: LogAdminActionParams): Promise<void> {
  const { request, actor, action, resource, targetId, before, after, meta } = params;

  try {
    const diffPayload = buildDiff(before, after, meta);
    // IP 는 ip-hash 단일 정책대로 해시해 저장한다(원문 저장 금지 — 다른 로그 경로와 동일).
    const clientIp = extractIp(request);
    await prisma.adminAuditLog.create({
      data: {
        actorId: actor.id,
        actorEmail: actor.email ?? "",
        action,
        resource,
        targetId: targetId ?? null,
        diff: diffPayload
          ? (diffPayload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        ip: clientIp ? hashIp(clientIp) : null,
        userAgent: extractUserAgent(request)?.slice(0, 500) ?? null,
      },
    });
  } catch (error) {
    // 감사 로그 적재 실패는 호출자의 mutation을 차단해서는 안 된다.
    // 실패 자체는 Sentry로만 보고하고 무음 처리한다.
    const captured = error instanceof Error ? error : new Error(String(error));
    Sentry.captureException(captured, {
      tags: { component: "audit-log" },
      extra: { action, resource, targetId },
    });
    console.error("[audit] logAdminAction failed:", captured);
  }
}

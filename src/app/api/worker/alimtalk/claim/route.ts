import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/worker-auth";
import { decryptString } from "@/lib/pii";
import {
  ALIMTALK_CLAIM_BATCH,
  ALIMTALK_LEASE_STALE_MS,
  ALIMTALK_MAX_ATTEMPTS,
  type AlimtalkButton,
  type AlimtalkClaimedMessage,
} from "@/lib/alimtalk/types";

export const runtime = "nodejs";

// POST /api/worker/alimtalk/claim — 발송 대기 메시지를 배치로 클레임한다.
// 수신번호는 여기서 복호화해 평문으로 넘긴다(릴레이에 PII_ENCRYPTION_KEY 를 두지 않기 위해).
// 어차피 message 본문에 고객명·차량이 평문으로 들어 있어 번호만 암호문으로 넘길 이유가 없다.
export async function POST(request: NextRequest) {
  const { error } = requireWorker(request, "ALIMTALK_RELAY_SECRET");
  if (error) return error;

  try {
    const now = new Date();
    const staleCutoff = new Date(now.getTime() - ALIMTALK_LEASE_STALE_MS);

    // PENDING 우선, 없으면 리스가 끊긴 SENDING(=릴레이가 죽음) 회수.
    // 회수 건은 msgIdx 가 같으므로 실제로 접수됐다면 비즈톡이 3012(중복)로 걸러낸다.
    const candidates = await prisma.alimtalkMessage.findMany({
      where: {
        attempts: { lt: ALIMTALK_MAX_ATTEMPTS },
        OR: [{ status: "PENDING" }, { status: "SENDING", claimedAt: { lt: staleCutoff } }],
      },
      orderBy: { createdAt: "asc" },
      take: ALIMTALK_CLAIM_BATCH,
      select: {
        id: true,
        status: true,
        templateCode: true,
        recipient: true,
        message: true,
        buttons: true,
        price: true,
        attempts: true,
      },
    });
    if (candidates.length === 0) return NextResponse.json({ messages: [] });

    const messages: AlimtalkClaimedMessage[] = [];
    for (const candidate of candidates) {
      // 이중 클레임 방지: 후보의 현재 상태를 조건으로 건 updateMany 가 1건일 때만 성공
      const leaseToken = randomUUID();
      const claimed = await prisma.alimtalkMessage.updateMany({
        where:
          candidate.status === "PENDING"
            ? { id: candidate.id, status: "PENDING" }
            : { id: candidate.id, status: "SENDING", claimedAt: { lt: staleCutoff } },
        data: {
          status: "SENDING",
          claimedAt: now,
          leaseToken,
          attempts: candidate.attempts + 1,
        },
      });
      if (claimed.count !== 1) continue;

      const recipient = decryptString(candidate.recipient);
      if (!recipient) {
        await prisma.alimtalkMessage.updateMany({
          where: { id: candidate.id, leaseToken },
          data: { status: "FAILED", failReason: "수신번호 복호화 실패", leaseToken: null },
        });
        continue;
      }

      messages.push({
        id: candidate.id,
        leaseToken,
        templateCode: candidate.templateCode,
        recipient,
        message: candidate.message,
        buttons: (candidate.buttons as AlimtalkButton[] | null) ?? [],
        ...(candidate.price !== null ? { price: candidate.price } : {}),
      });
    }

    return NextResponse.json({ messages });
  } catch (e) {
    console.error("[alimtalk claim]", e);
    return NextResponse.json({ error: "클레임 실패" }, { status: 500 });
  }
}

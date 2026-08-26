import { getAlimtalkQueueStatus } from "@/lib/admin-queries";
import { getAwaitingQuoteDeliveries } from "@/lib/admin-queries/awaiting-quote-deliveries";
import { AlimtalkQueueBoard } from "@/components/admin/alimtalk/AlimtalkQueueBoard";
import { AwaitingQuoteDeliveries } from "@/components/admin/alimtalk/AwaitingQuoteDeliveries";

export const dynamic = "force-dynamic";

export const metadata = { title: "알림톡 발송 큐 | 아임딜러 어드민" };

export default async function AlimtalkQueuePage() {
  // 권한은 (admin) 레이아웃의 requireAccess + PAGE_ACCESS 가 처리한다.
  // 자동 갱신 없음 — 재방문 시 이 쿼리가 다시 실행된다.
  const [status, awaiting] = await Promise.all([
    getAlimtalkQueueStatus(),
    getAwaitingQuoteDeliveries(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <AlimtalkQueueBoard status={status} />
      <AwaitingQuoteDeliveries items={awaiting} />
    </div>
  );
}

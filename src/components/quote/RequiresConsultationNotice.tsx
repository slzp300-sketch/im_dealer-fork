"use client";

import { AlertCircle } from "lucide-react";
import { ChannelTalkButton } from "@/components/quote/ChannelTalkButton";

interface RequiresConsultationNoticeProps {
  readonly vehicleName?: string;
}

export function RequiresConsultationNotice({ vehicleName }: RequiresConsultationNoticeProps) {
  return (
    <div className="public-mobile-section mb-4 p-5 md:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand/10">
          <AlertCircle size={20} className="text-brand" />
        </div>
        <div>
          <p className="text-[15px] font-semibold leading-snug text-ink">
            이 차량은 별도 상담이 필요합니다
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-label">
            현재 자동 견적에 필요한 데이터가 등록되지 않아 정확한 금액을 즉시 산출하기 어렵습니다.
            전문 상담을 통해 맞춤 견적을 받아보실 수 있습니다.
          </p>
        </div>
      </div>
      <div className="rounded-[12px] border border-border-subtle bg-surface-soft p-3 text-[12px] leading-relaxed text-text-muted">
        옵션·계약조건에 따라 캐피탈사별 금액이 크게 달라질 수 있어 상담을 통한 견적이 더 정확합니다.
      </div>
      <ChannelTalkButton
        vehicleName={vehicleName}
        label="상담하기"
        className="mt-4 min-h-[48px] rounded-[12px] px-4 py-0 text-[14px] font-bold shadow-lift"
      />
    </div>
  );
}

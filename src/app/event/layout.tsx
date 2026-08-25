import type { ReactNode } from "react";
import { ChannelTalk } from "@/components/layout/ChannelTalk";

// 채널톡↔카카오 연동 컨텍스트 추적(trackEventConsultation)을 위해 스크립트만 로드한다.
// hideChannelButtonOnBoot: true 로 부팅되므로 플로팅 버튼은 뜨지 않는다.
export default function EventLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ChannelTalk />
    </>
  );
}

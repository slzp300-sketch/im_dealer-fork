// 상담 진입 라우팅 플래그. 모바일 로그인 회원의 「상담하기」를 카카오 직행 대신
// CONSULT_REQUEST 알림톡(상담톡전환 버튼)으로 보낼지 결정한다. 라우팅이 클라이언트에서
// 일어나므로 클라에서 읽을 수 있는 NEXT_PUBLIC 값으로 둔다. 기본값은 꺼짐(false).
export function isMemberMobileConsultEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MEMBER_MOBILE_CONSULT === "true";
}

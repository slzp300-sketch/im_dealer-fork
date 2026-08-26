// 비즈톡 결과코드 분류. 재시도해도 결과가 달라지지 않는 코드에 재시도를 걸면
// 과금만 늘고 큐가 막히므로, "일시 장애"만 재시도 대상으로 좁게 잡는다.

/** 접수(sendAlimTalk) 응답 중 잠시 후 다시 보내면 될 것들. */
const RETRYABLE_RESPONSE_CODES = new Set([
  "B215", // 1분 14회 초과
  "B208", // 시스템 오류
  "B300", // 처리 실패
  "9998",
  "9999",
]);

export function isRetryableResponseCode(code: string): boolean {
  return RETRYABLE_RESPONSE_CODES.has(code);
}

// 전송 결과(resultCode) 단계의 재시도는 여기서 다루지 않는다.
// 이미 접수된 메시지는 msgIdx 가 소진돼 같은 행으로 재발송하면 3012(중복)가 된다.
// 재발송하려면 새 행을 만들어야 하고, 그 정책은 운영 안정화(Phase 3) 단계에서 정한다.

/**
 * 운영자가 로그만 보고 원인을 알 수 있게 코드에 설명을 붙인다.
 * 목록에 없으면 코드만 남긴다(비즈톡 코드표가 계속 늘어나므로 전부 나열하지 않는다).
 */
const CODE_LABELS: Record<string, string> = {
  B199: "인증 실패 (IP 미등록 또는 토큰 문제)",
  B203: "JSON 형식 오류",
  B210: "BS 계정 없음",
  B211: "BS 계정 정지",
  B213: "BS 계정 권한 없음",
  B215: "요청 횟수 초과",
  B301: "여신건수 초과 (충전 필요)",
  "1000": "성공",
  "1003": "발신 프로필 키가 유효하지 않음",
  "1030": "잘못된 파라미터 (버튼 링크 확인)",
  "3005": "수신 여부 불확실",
  "3008": "전화번호 오류",
  "3012": "msgIdx 중복",
  "3015": "템플릿을 찾을 수 없음 (미승인/휴면)",
  "3016": "템플릿 본문 불일치",
  "3018": "최근 7일간 카카오톡 미사용",
  "3019": "카카오톡 사용자 아님",
  "3020": "알림톡 수신 차단",
  "3027": "템플릿 버튼 불일치",
  "3028": "템플릿 강조표기 불일치",
  ME09: "수신 여부 불확실",
};

export function describeCode(code: string, msg?: string): string {
  const label = CODE_LABELS[code];
  const detail = msg?.trim();
  return [code, label, detail].filter(Boolean).join(" · ").slice(0, 500);
}

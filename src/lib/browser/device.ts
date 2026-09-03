/**
 * 접속 기기 판별. 상담 진입을 접속 환경별로 분리하는 데 쓴다
 * (모바일=카카오 채널 직결, PC=채널톡 위젯).
 *
 * 전역 navigator 를 직접 읽지 않고 인자로도 받을 수 있게 해, 실기기 없이 단위
 * 테스트할 수 있게 한다(in-app.ts 와 같은 규약). 서버(navigator 없음)에서는 false.
 */

const MOBILE_UA = /android|iphone|ipad|ipod/i;

/** UA 가 모바일(휴대폰·태블릿) 기기인지 판별한다. */
export function isMobileDevice(userAgent?: string): boolean {
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  return MOBILE_UA.test(ua);
}

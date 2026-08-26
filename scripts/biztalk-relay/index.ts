// .env 를 다른 import 보다 먼저 로드 (ESM 호이스팅 — load-env 가 항상 첫 import 여야 함)
import "./load-env";

import type {
  AlimtalkAcceptReport,
  AlimtalkResultReport,
} from "../../src/lib/alimtalk/types";
import { describeCode } from "../../src/lib/alimtalk/result-codes";
import { claimMessages, reportAccepted, reportResults } from "./app-client";
import { ackResultPoll, getResultPoll, getToken, sendAlimTalk } from "./biztalk-client";

/**
 * 비즈톡 알림톡 릴레이.
 *
 * 비즈톡 API 는 사전 등록된 고정 IPv4 에서만 호출할 수 있는데 Vercel 서버리스에는
 * 고정 egress IP 가 없다. 그래서 고정 IP 를 가진 이 프로세스가 앱 대신 발송한다.
 *
 * 앱을 향해 나가는 연결만 쓴다(claim → send → accept, poll → result → ack).
 * 인바운드가 없으므로 이 서버에 도메인·인증서·열린 포트가 필요 없다.
 *
 * 전송 결과 조회는 매뉴얼상 단일 프로세스·단일 스레드여야 한다. 이 프로세스를
 * **두 개 이상 띄우지 말 것** — 결과가 중복·유실된다.
 */

const SEND_POLL_MS = Number(process.env.RELAY_SEND_POLL_MS ?? 5000);
// 전송 결과 요청은 1분 14회 제한 + 10초 이상 간격 권장. 여유를 두고 30초.
const RESULT_POLL_MS = Number(process.env.RELAY_RESULT_POLL_MS ?? 30000);
const RESULT_POLL_MIN_MS = 10000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let stopping = false;

function requireEnv(): void {
  const missing = [
    "APP_BASE_URL",
    "ALIMTALK_RELAY_SECRET",
    "BIZTALK_BSID",
    "BIZTALK_PASSWD",
    "BIZTALK_SENDER_KEY",
  ].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `[relay] 필수 환경변수 누락: ${missing.join(", ")} (scripts/biztalk-relay/.env 확인)`
    );
    process.exit(1);
  }
}

/**
 * 기동 즉시 토큰을 한 번 받아본다.
 * IP 미등록(B199 / UnregistedIpAddressException)은 가장 흔한 설정 실수인데,
 * 여기서 걸러내지 않으면 첫 발송 건을 하나 태운 뒤에야 원인을 알게 된다.
 */
async function preflight(): Promise<boolean> {
  try {
    await getToken();
    console.log("[relay] 비즈톡 토큰 발급 확인 완료");
    return true;
  } catch (e) {
    console.error(`[relay] 비즈톡 연결 실패: ${e instanceof Error ? e.message : String(e)}`);
    console.error("[relay] 이 서버의 공인 IPv4 가 비즈톡에 등록되어 있는지 확인하세요.");
    return false;
  }
}

async function sendLoop(): Promise<void> {
  while (!stopping) {
    try {
      const messages = await claimMessages();
      const reports: AlimtalkAcceptReport[] = [];

      for (const message of messages) {
        try {
          const result = await sendAlimTalk({
            msgIdx: message.id,
            templateCode: message.templateCode,
            recipient: message.recipient,
            message: message.message,
            buttons: message.buttons,
            price: message.price,
          });
          reports.push({
            id: message.id,
            leaseToken: message.leaseToken,
            responseCode: result.responseCode,
            msg: result.msg,
          });
        } catch (e) {
          // 네트워크·타임아웃 등. 접수 여부가 불확실하지만 msgIdx 가 같으므로
          // 재클레임되어 다시 보내도 비즈톡이 중복(3012)으로 걸러낸다.
          console.error(`[relay] 발송 실패 ${message.id}:`, e instanceof Error ? e.message : e);
        }
      }

      if (reports.length) {
        await reportAccepted(reports);
        const accepted = reports.filter((r) => r.responseCode === "1000").length;
        console.log(`[relay] 발송 ${reports.length}건 (접수 성공 ${accepted}건)`);
      }
    } catch (e) {
      console.error("[relay] 발송 루프 오류:", e instanceof Error ? e.message : e);
    }
    await sleep(SEND_POLL_MS);
  }
}

async function resultLoop(): Promise<void> {
  const interval = Math.max(RESULT_POLL_MS, RESULT_POLL_MIN_MS);
  while (!stopping) {
    try {
      const poll = await getResultPoll();
      if (poll.items.length > 0) {
        const results: AlimtalkResultReport[] = poll.items
          .filter((item) => item.msgIdx && item.resultCode)
          .map((item) => ({
            msgIdx: item.msgIdx as string,
            resultCode: item.resultCode as string,
            sendType: item.sendType,
            uid: item.uid,
          }));

        // 앱 기록이 성공한 뒤에만 ack 한다. 실패하면 ack 하지 않으므로 다음 폴링에
        // 같은 결과가 다시 내려온다 — 결과 24시간 보관 제한 안에서 유실되지 않는다.
        await reportResults(results);
        if (poll.pk) await ackResultPoll(poll.pk);
        console.log(
          `[relay] 전송 결과 ${results.length}건 반영 — ${summarizeResultCodes(results)}`
        );
      }
    } catch (e) {
      console.error("[relay] 결과 루프 오류:", e instanceof Error ? e.message : e);
    }
    await sleep(interval);
  }
}

// 접수(responseCode 1000)와 도달은 다르다. 실패 원인은 resultCode 로만 드러나는데
// 이전에는 건수만 남겨서 pm2 logs 만으로는 왜 안 갔는지 알 수 없었다.
function summarizeResultCodes(results: AlimtalkResultReport[]): string {
  const counts = new Map<string, number>();
  for (const r of results) {
    counts.set(r.resultCode, (counts.get(r.resultCode) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([code, n]) => `${describeCode(code)} ${n}건`)
    .join(", ");
}

async function main(): Promise<void> {
  requireEnv();
  if (!(await preflight())) return;

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      console.log(`[relay] ${signal} 수신 — 종료합니다.`);
      stopping = true;
    });
  }

  console.log(
    `[relay] 시작 — 발송 ${SEND_POLL_MS}ms / 결과 ${Math.max(RESULT_POLL_MS, RESULT_POLL_MIN_MS)}ms 주기` +
      (process.env.BIZTALK_TEST_MODE === "true" ? " (테스트 발송 모드)" : "")
  );
  await Promise.all([sendLoop(), resultLoop()]);
}

void main();

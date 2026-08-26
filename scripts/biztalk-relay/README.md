# 비즈톡 알림톡 릴레이

비즈톡 BGMS API 는 **사전 등록된 고정 IPv4 에서만** 호출할 수 있는데 Vercel 서버리스에는 고정 egress IP 가 없다. 그래서 고정 IP 를 가진 이 프로세스가 앱 대신 발송한다.

앱을 향해 **나가는 연결만** 사용한다. 이 서버에 도메인·TLS 인증서·열린 포트가 필요 없다.

```
앱(Vercel)  ←── claim ──  릴레이  ── sendAlimTalk ──→  비즈톡
           ──→ accept ──         ←── responseCode ──
           ←── result ──         ── getResultPoll ──→
           ──→   ok   ──         ── ackResultPoll  ──→   (앱 기록 성공 후에만)
```

> ⚠️ **이 프로세스를 두 개 이상 띄우지 말 것.** 전송 결과 조회는 매뉴얼상 단일 프로세스·단일 스레드여야 하며, 중복 실행 시 결과가 중복되거나 유실된다.

## 준비

1. 고정 공인 IPv4 를 가진 서버 1대 (Lightsail / Vultr / Oracle Free 등). 인바운드 포트 개방 불필요.
2. 비즈톡센터 **마이페이지 > 메시지 발송 정보 > 등록 서버 정보** 의 `서버 등록` 으로 **직접 등록**한다.
   IPv4 only, 최대 50개, 반영까지 최대 5분. 서버명은 영문·숫자·한글·하이픈·언더바만 쓸 수 있다.
   50개를 넘겨야 하면 ts-sm@biztalk.co.kr 로 문의한다.
3. 비즈톡센터에서 **BS ID / BS PW / 발신프로필키** 확보.
   - BS PW·발신프로필키는 화면에 표시되지 않고 `[선택 메일 발송]` 로만 수령한다.
4. 템플릿 검수 승인 후 받은 `tmpltCode` 는 **앱(Vercel) 환경변수**에 넣는다. 릴레이는 몰라도 된다.

## 설치·실행

```bash
git clone <repo> && cd im_dealer
pnpm install
cp scripts/biztalk-relay/.env.example scripts/biztalk-relay/.env
# .env 편집 후
pnpm biztalk:relay
```

기동 시 토큰을 한 번 발급받아 본다. 여기서 실패하면 대부분 **IP 미등록**(`B199 / UnregistedIpAddressException`)이다.

상시 구동은 pm2 를 쓴다.

```bash
pnpm add -g pm2
pm2 start "pnpm biztalk:relay" --name biztalk-relay
pm2 save && pm2 startup
```

## 환경변수

`.env.example` 참조. `DATABASE_URL` 도 `PII_ENCRYPTION_KEY` 도 필요 없다 — 릴레이는 DB 에 직접 접근하지 않고, 수신번호는 앱이 복호화해서 넘겨준다.

## 테스트 발송

`BIZTALK_TEST_MODE=true` 로 두면 `sendAlimTalkTF` 로 나가 **사전 등록된 테스트 번호(최대 3개)** 에만 도달한다. 오발송은 막히지만 **성공 시 과금은 동일**하다.

## 운영 중 확인할 것

| 증상 | 원인 |
|---|---|
| `B199 / UnregistedIpAddress...` | 서버 IP 미등록. 서버 교체·IP 변경 시 재등록 필요 |
| `B301` | 여신건수 초과 — 충전 필요. 발송이 전면 중단된다 |
| `resultCode 3015` | 템플릿 미승인 또는 휴면. 비즈톡센터에서 해제 |
| `resultCode 3016/3027/3028` | 본문·버튼이 승인 템플릿과 불일치. `src/lib/alimtalk/templates.ts` 수정 필요 (재시도 무의미) |
| 결과가 계속 다시 내려옴 | 앱 보고가 실패해 ack 되지 않는 중. 앱 로그 확인 |

**릴레이가 멈춰도 발송 요청은 유실되지 않는다** — 큐가 앱 DB 에 있어서 `PENDING` 으로 쌓이고, 다시 켜면 이어서 나간다. 다만 전송 결과는 비즈톡에 **24시간만** 보관되므로 하루 이상 방치하면 결과를 못 받는다.

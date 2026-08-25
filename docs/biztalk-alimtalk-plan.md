# 비즈톡 알림톡(BGMS API) 연동 계획

**작성일:** 2026-08-14
**근거 자료:** `비즈톡 BGMS API(KKO) v3.3.6.pdf` (249p), 비즈톡 서비스 가입 완료 안내 메일(2026-08-06, mb@biztalk.co.kr → 메타키움 → 전달)
**관련 문서:** [kakao-sync-setup.md](kakao-sync-setup.md), [kakao-sync-quote-automation-plan.md](kakao-sync-quote-automation-plan.md), 사내 진행 요청서 `scratch/biztalk/비즈톡-진행-요청서.md`(2026-07-30, 템플릿 초안 A~C 포함)

---

## 0. 한 줄 요약

계약·자료는 다 확보됐고 API 자체는 단순하다(토큰 → 발송 → 결과조회). **실제 블로커는 코드가 아니라 두 가지**다:
1. **고정 IP 화이트리스트** — 등록된 IPv4에서만 API 호출 가능. Vercel 서버리스는 고정 egress IP가 없다. → 릴레이 서버 필요.
2. **템플릿 사전 검수** — 알림톡은 카카오 검수를 통과한 템플릿만 발송 가능하고, 발송 본문이 템플릿과 **글자 단위로** 일치해야 한다. 검수는 영업일 수일.

이 둘은 코드 작업과 **병렬로 즉시 착수**해야 전체 일정이 밀리지 않는다. 과금은 계약 확정 월(8월)부터 사용량과 무관하게 기본료가 나가므로 지연 = 손실.

---

## 1. 확보된 사실 (자료에서 확인된 것)

### 1.1 접속 정보

| 항목 | 값 |
|---|---|
| 운영 Host | `https://www.biztalk-api.com` |
| 전체친구 발송 전용 Host | `https://brandmsg.biztalk-api.com:8443` |
| 비즈톡센터(Admin) | `https://www.biztalk-center.co.kr` |
| 프로토콜 | HTTPS, JSON, UTF-8. client timeout **100초 권장** |
| 개발 문의 | ts-sm@biztalk.co.kr |
| 센터/운영 문의 | mb@biztalk.co.kr |
| 고객센터(테스트번호·서버IP 등록) | help@biztalk.co.kr |

### 1.2 발급받아야 할 크리덴셜

| 항목 | 획득 경로 |
|---|---|
| **BS ID** | 비즈톡센터 → 마이페이지 → 고객정보 → 메시지 발송 정보 |
| **BS PW** | 위 화면에서 BS ID 체크 → `[선택 메일 발송]` → 담당자 메일로 수신 (센터에 노출 안 됨) |
| **발신프로필키(senderKey)** | 비즈톡센터 → 마이페이지 → 채널 관리 → 채널 선택 → `[선택 메일 발송]` |
| **템플릿 코드(tmpltCode)** | 알림톡 관리 → 템플릿 관리 → 등록 후 검수 요청 → 승인 시 부여 |

> 사내 요청서에는 "API Key / Secret"으로 적혀 있으나, 비즈톡 BGMS의 실제 크리덴셜은 **BS ID + BS PW + 발신프로필키** 3종이다. 전달 요청 시 이 이름으로 요청해야 혼선이 없다. BS PW는 센터 화면에 표시되지 않고 **담당자 메일로만** 발송된다.

### 1.3 API 표면 (우리가 쓸 것만)

```
POST /v2/auth/getToken          { bsid, passwd, expire? }  → { responseCode, token, expireDate }
POST /v2/kko/sendAlimTalk       헤더 bt-token, 본문 아래 참조
POST /v2/kko/sendAlimTalkBatch  { msgList: [...] }  1회 최대 500건
POST /v2/kko/sendAlimTalkTF     테스트 번호(최대 3개) 전용. 성공 시 동일 과금
GET  /v2/kko/getResultPoll      → { pk, response: [...] }  1회 최대 500건
POST /v2/kko/ackResultPoll      { pk }   ← ack 안 하면 같은 결과 반복 수신
GET  /v2/kko/getResultAll       일괄 조회(가져가면 큐에서 삭제)
POST /v2/kko/addBanList | selectBanList | deleteBanList   수신 차단 번호 관리
```

**sendAlimTalk 필수 파라미터**

| 키 | 제약 | 비고 |
|---|---|---|
| `msgIdx` | Text(40) | **전역 고유값**. 중복 시 resultCode 3012 |
| `countryCode` | `"82"` | |
| `resMethod` | `"PUSH"` | |
| `senderKey` | Text(40) | 발신프로필키 |
| `tmpltCode` | Text(40) | 승인된 템플릿 코드 |
| `message` | Text(1300) | 변수 치환 완료된 **최종 본문**. 줄바꿈은 `\n`만 |
| `recipient` | Text(20) | `01012345678` 또는 `010-1234-5678` |

선택: `attach.button[]`(최대 5개), `supplement.quick_reply[]`, `link`(대표링크), `title`(강조표기), `messageType`(`AT` 기본 / `AI` 이미지), `useFailback`+`mmsAttach`(문자 재처리), `price`/`currencyType`, `header`.

버튼 타입: `WL`(웹링크) / `AL`(앱링크) / `BK`(봇키워드) / `MD`(메시지전달) / `AC`(채널추가) / `BT`(챗봇) / `DS`(배송조회) / `TN`(전화) / `MP`(지도) / `P1~P3`(플러그인).

### 1.4 반드시 알아야 할 제약

| # | 제약 | 영향 |
|---|---|---|
| 1 | **등록된 서버 IPv4에서만 호출 가능** (최대 10개, IPv4 only, DNS 불가) | 아키텍처 결정 사항 #1. 미등록 IP는 `B199 / UnregistedIpAddressException` |
| 2 | 토큰은 **발급받은 IP에서만** 유효. 기본 24시간(최소 60분) | 릴레이 프로세스 단위 캐시 |
| 3 | 토큰 요청 **1분 14회** 제한 (`B215`) | 12시간마다 갱신 권장 |
| 4 | 전송결과 요청도 **1분 14회**, **10초 이상 간격** 권장 | 폴링 주기 ≥ 10초, 30초 권장 |
| 5 | 전송결과 요청은 **단일 프로세스·단일 스레드** | Vercel 크론(동시 실행 가능)으로 폴링하면 결과 중복/유실 |
| 6 | 결과는 큐 적재 후 **24시간만 보관** | 24시간 내 반드시 수집. 놓치면 영구 유실 |
| 7 | 알림톡은 **정보성만**. 광고성은 브랜드 메시지(친구톡) 영역 | 쿠폰·프로모션은 알림톡으로 못 보냄 |
| 8 | 본문/버튼이 승인 템플릿과 불일치하면 실패 (3016 / 3027 / 3028) | 템플릿-코드 동기화 필수 |
| 9 | 버튼 링크 유효성 검증 있음 (미치환 변수 `https://#{x}` 등 → 1030) | 링크 생성 후 검증 |
| 10 | 응답 `responseCode:1000`은 **접수 성공일 뿐** | 실제 도달 여부는 `resultCode`로만 확인 |
| 11 | 문자 재처리(`useFailback`)는 **문자서비스 신청 + 발신번호 등록**이 선결 | **계약에 문자 미포함 → 범위 밖.** 알림톡 실패는 실패로 기록만 |
| 12 | 브랜드 메시지(광고성)는 **08:00~20:50**만 발송 가능 (3022) | 알림톡은 해당 없음 |

---

## 2. 현재 코드 기준선

| 영역 | 현재 상태 | 위치 |
|---|---|---|
| 견적서 카톡 전송 | 카카오 **"나에게 보내기"**(본인 카톡). `talk_message` 동의 + 리프레시 토큰 필요 | `src/app/api/quote/deliver/route.ts`, `src/lib/kakao/memo.ts` |
| 전송 이력 | `QuoteDelivery` (channel = `memo` / `friendtalk`, status `PENDING/SENT/FAILED`) | `prisma/schema.prisma:717` |
| 전화번호 | `User.phone` — 카카오 원본 형식(`+82 10-...`) 저장, 정규화 유틸 존재 | `src/lib/phone.ts` |
| PII 암호화 | `PII_ENCRYPTION_KEY` 기반 유틸 + 파기 크론 존재 | `src/lib/pii.ts`, `/api/cron/purge-pii` |
| 크론 | Vercel Cron 5개 운영 중 | `vercel.json` |
| 외부 워커 | 수집 PC 워커 presence 체크 구조 존재(스크래퍼용) | `src/lib/scraper/worker-presence.ts` |
| 알림톡 | 큐·릴레이·워커 라우트 구현 완료(Phase 1·2). **크리덴셜과 템플릿 코드만 들어오면 동작** | `src/lib/alimtalk/`, `src/app/api/worker/alimtalk/`, `scripts/biztalk-relay/` |

**의미:** 알림톡은 기존 "나에게 보내기"의 **대체가 아니라 확장**이다.
- 나에게 보내기 = 로그인 + `talk_message` 동의 + 유효 리프레시 토큰 필요 → 이탈 지점이 많다.
- 알림톡 = **전화번호만 있으면** 채널 친구가 아니어도 발송 가능 → 도달률이 근본적으로 높다.
→ 견적서 전송의 **1순위를 알림톡으로 바꾸고**, 나에게 보내기는 폴백/보조로 남기는 구성을 권장.

---

## 3. 확정된 결정

### D1. 고정 IP 확보 방식 → **릴레이 서버 (확정)**

| 안 | 평가 |
|---|---|
| **A. 릴레이 서버 — 채택** | 소형 VPS(Lightsail/Vultr/Oracle Free) 1대. 월 $5 내외. 제약 #1·#5·#6을 **한 번에** 해결하고, 결과 폴링의 단일 프로세스 보장이 자연스럽게 성립 |
| B. Vercel Secure Compute | Enterprise 플랜 전용 — 배제 |
| C. 수집 PC(기존 워커)에 얹기 | 가정용 회선은 IP 변동, PC 꺼지면 발송 중단 — 배제 |
| D. 비즈톡에 대역(CIDR) 등록 | Vercel은 안정적 egress 대역을 공개하지 않음 — 실효성 없음 |

### D2. 문자 재처리(SMS/LMS 폴백) → **범위 밖 (확정)**
계약에 문자서비스가 포함되어 있지 않다. `useFailback` / `mmsAttach` 는 구현하지 않는다.
알림톡 실패(3018 카톡 미사용 / 3019 톡 유저 아님 / 3020 수신차단)는 **실패로 기록만** 하고, 기존 "나에게 보내기"·이메일 등 기존 경로가 폴백 역할을 한다.

### D3. 발송 범위 → **카카오 알림톡 자동발송만 (확정)**
필요한 것은 카카오톡 메시지 자동발송이다. 브랜드 메시지(친구톡)·수신차단 API·배치 발송은 이번 범위에서 제외하고 필요해지면 별도 판단한다. 1차 템플릿 배치는 §5.

---

## 4. 목표 아키텍처 — 아웃바운드 폴링 릴레이

릴레이는 **인바운드 요청을 받지 않는다.** 앱을 향해 나가는 연결만 사용한다.

```
[Next.js on Vercel]                       [릴레이 (고정 IP VPS)]            [비즈톡]
                                            토큰 캐시(12h)
  AlimtalkMessage(PENDING)                       │
      │◄── POST /api/worker/alimtalk/claim ──────┤  (Bearer, 5초 주기)
      │──── 발송할 메시지 배치(≤20) ────────────►│
      │      status: PENDING → SENDING            ├── POST /v2/kko/sendAlimTalk ──►
      │◄── POST /api/worker/alimtalk/accept ─────┤◄── {responseCode, msg} ────────
      │      status: ACCEPTED / FAILED            │
      │                                           │  결과 폴링 (같은 프로세스, 30초)
      │                                           ├── GET  /v2/kko/getResultPoll ─►
      │◄── POST /api/worker/alimtalk/result ─────┤◄── {pk, response[]} ───────────
      │      status: SENT / FAILED                ├── POST /v2/kko/ackResultPoll ─►
      │      resultCode·sendType·uid 기록         │      (앱 기록 성공 후에만 ack)
```

**설계 근거**
- **인바운드 없음** → VPS에 도메인·TLS 인증서·방화벽 개방이 전부 불필요하다. 아웃바운드 HTTPS만 열려 있으면 된다. 운영 비용이 크게 줄고, 릴레이가 공격면이 되지 않는다.
- **기존 수집 PC 워커와 동일한 패턴**이다(`scripts/scraper-worker/` → `/api/worker/scrape-jobs/claim`). 팀이 이미 운영해 본 구조라 새 운영 지식이 필요 없다.
- **큐가 DB에 있다** → 릴레이가 죽어도 발송 요청은 `PENDING`으로 쌓이고, 복구 시 그대로 이어서 나간다. 인바운드 프록시 방식이면 릴레이 다운 = 그 순간의 발송 요청 유실이다.
- **결과 폴링은 상주 루프.** Vercel 크론은 동시 실행 가능성이 있어 제약 #5(단일 프로세스)를 못 지킨다.
- **ack는 앱 기록 성공 후에만.** 앱 기록에 실패하면 ack하지 않으므로 다음 폴링에서 같은 결과를 다시 받는다 → 24시간 유실 위험이 구조적으로 차단된다.
- **DB 자격증명은 릴레이로 가지 않는다.** 릴레이가 아는 것은 앱 URL + 워커 시크릿 + 비즈톡 크리덴셜뿐이다.
- 비즈톡의 **전송결과 Push**(BSID당 URL 1개 등록)는 "한 번만 전송, 재전송 없음"이라 단독으로는 위험하고 인바운드 엔드포인트도 필요해진다. 도입하지 않는다.

**트레이드오프:** 발송이 즉시가 아니라 **최대 5초 지연**된다(폴링 주기). 견적서·상담접수 안내에서 5초는 문제되지 않는다. 접수 결과(`responseCode`)도 API 응답으로 즉시 돌려받지 못하고 비동기로 DB에 반영된다.

---

## 5. 알림톡 템플릿 1차 배치

**문안은 이미 작성되어 있다** — `scratch/biztalk/비즈톡-진행-요청서.md` [첨부 1]의 템플릿 A/B/C를 그대로 1차 배치로 쓴다. 새로 만들 필요 없이 **대표님 확정만 받으면 즉시 검수 접수 가능**하다.

| 코드 키 | 문안 | 버튼 | 우선순위 |
|---|---|---|---|
| `QUOTE_DELIVERED` | 템플릿 A — 견적서 도착 안내 | `WL` "견적서 확인하기" → `/quote/delivery/{id}` | 1 |
| `CONSULT_RECEIVED` | 템플릿 B — 상담 신청 접수 안내 | `WL` "내 견적 다시 보기" | 1 |
| `REVIEW_REQUEST` | 템플릿 C — 후기 작성 요청 | `WL` "후기 작성하기" → 1회용 review-token 링크 | 2 |

> **코드에는 A(`QUOTE_DELIVERED`)만 들어가 있다.** B는 상담 접수 API가, C는 계약 완료 시점이 아직 없어서(상담은 현재 채널톡 수동 대응) 발송을 걸 지점이 없다. 검수는 A·B·C를 함께 올려두고, B·C는 호출 지점이 생길 때 `src/lib/alimtalk/templates.ts` 에 추가한다.
> A의 등록 원문은 `QUOTE_DELIVERED_DRAFT` 상수에 그대로 들어 있다. **비즈톡센터 등록 시 이 문자열을 복사해서 쓸 것** — 한 글자라도 다르면 3016으로 전량 실패한다. 테스트가 "등록 원문의 변수만 치환한 결과 = 실제 발송 본문"을 검증한다.

**검수 접수 전 점검할 것**
- 변수는 `#{변수명}` 표기로 등록하고, 발송 시에는 **치환이 끝난 최종 문자열**을 `message`에 넣는다.
- 버튼 링크의 프로토콜(`https://`)은 **고정 영역**으로 등록해야 한다. `https://#{변수}` 형태로 남으면 링크 검증에 걸려 실패(1030)한다.
- 템플릿 A의 `■ 월 납입금: #{월납입금}원 (#{금융사} 기준)`은 금액 표기가 들어가므로 `price` / `currencyType` 파라미터를 함께 보내는 편이 안전하다.
- 템플릿 C의 "소중한 이용 경험을 남겨주시면 다른 고객님께 큰 도움이 됩니다" 는 심사자에 따라 광고성으로 볼 여지가 있다. **A·B를 먼저 접수하고 C는 별도 접수**해서, C가 반려돼도 1순위 오픈이 밀리지 않게 한다.

**보내면 안 되는 것:** 쿠폰 발급/만료 임박, 프로모션, 신차 입고 소식 → 광고성. 브랜드 메시지(친구톡, 채널 친구 + 마케팅 동의 필요) 영역이며 별도 검토 대상.

---

## 6. 진행 단계

### Phase 0 — 외부 준비 (코드와 병렬, 즉시 착수) ⏱ 리드타임 최대

- [ ] **P0-1** 비즈톡센터 로그인 → BS ID 확인, `[선택 메일 발송]`으로 BS PW 수령
- [ ] **P0-2** 카카오 → 채널관리 → **발신프로필키 발급** 및 메일 수령
- [ ] **P0-3** 릴레이 서버 프로비저닝 → 고정 IPv4 확보 (인바운드 포트 개방 불필요, 도메인·TLS 불필요)
- [ ] **P0-4** help@biztalk.co.kr 에 **서버IP 등록 요청** (비즈톡센터 ID + IPv4)
- [ ] **P0-5** help@biztalk.co.kr 에 **테스트 번호 등록 요청** (최대 3개 — 담당자 휴대폰)
- [ ] **P0-6** 템플릿 A·B(요청서 [첨부 1]) 대표님 확정 → 비즈톡센터 등록 → 검수 요청 → 승인 후 `tmpltCode` 확보 (C는 별도 접수)

**검증:** 릴레이에서 `curl /v2/auth/getToken` → `responseCode: 1000` + 토큰 수신.

### Phase 1 — 릴레이 (`scripts/biztalk-relay/`, `pnpm biztalk:relay`)

수집 PC 워커(`scripts/scraper-worker/`)와 동일한 구조. 상주 프로세스 1개.

- [x] **P1-1** `load-env.ts` + 필수 환경변수 검증 + 기동 시 프리플라이트(토큰 발급 1회)
- [x] **P1-2** 토큰 캐시 (만료 30분 전 갱신, B199 시 1회 재발급 후 재시도)
- [x] **P1-3** 발송 루프 — `claim` → `sendAlimTalk` → `accept`(접수결과 보고), 5초 주기
- [x] **P1-4** 결과 폴링 루프 — 30초 주기, `getResultPoll` → `result`(앱 보고) **성공 시에만** `ackResultPoll`
- [x] **P1-5** `README.md` (VPS 세팅·pm2 상시 구동·IP 등록 절차)

**검증:** 테스트 번호로 `sendAlimTalkTF` 발송 → 실제 수신 확인 → 폴링으로 `resultCode: 1000` 수신 → DB 반영.

### Phase 2 — 앱 측 발송 파이프라인

- [x] **P2-1** Prisma `AlimtalkMessage` 모델 + 마이그레이션 (§7, RLS deny-all)
- [x] **P2-2** `src/lib/alimtalk/templates.ts` — 등록 원문·본문 빌더·버튼을 **한 파일에** 정의
- [x] **P2-3** `src/lib/alimtalk/enqueue.ts` — 번호 정규화(`01012345678`), 암호화 적재
- [x] **P2-4** `POST /api/worker/alimtalk/claim` — 배치 클레임(PENDING → SENDING, leaseToken)
- [x] **P2-5** `POST /api/worker/alimtalk/accept` — 접수결과(`responseCode`) 반영
- [x] **P2-6** `POST /api/worker/alimtalk/result` — 전송결과(`resultCode`) 반영
- [x] **P2-7** 견적서 전송 경로에 알림톡 연결 (`/api/quote/deliver` 확장)
- [x] **P2-8** 환경변수 플래그 `ALIMTALK_ENABLED` — OFF면 기존 동작 그대로

**검증:** 스테이징에서 테스트 번호로 견적서 발송 → `AlimtalkMessage.status = SENT`, 카톡 수신, 버튼 링크 정상 이동.

### Phase 3 — 운영 안정화

- [ ] **P3-1** 결과코드 → 사용자 대응 매핑 (§8)
- [ ] **P3-2** 재시도: 일시 오류(3006/9998/B208/B300)만 최대 3회, 영구 실패는 재시도 금지
- [ ] **P3-3** 미수신 감시 — 접수 후 30분 내 결과 미도착 건 알림 (24시간 유실 방지)
- [ ] **P3-4** 관리자 화면에 발송 로그(수신자·템플릿·상태·결과코드·재발송)
- [ ] **P3-5** 전화번호 암호화 저장 + `purge-pii` 크론에 발송 이력 포함

### Phase 4 — 확장 (별도 판단)

- 배치 발송(`sendAlimTalkBatch`, 500건/회) — 대량 안내가 생기면
- 수신 차단 API(`addBanList`) — 수신거부 요청이 실제로 들어오면
- 브랜드 메시지(친구톡) — 광고성 발송이 필요해지면. **채널톡 구축과 범위 겹침** → 채널톡 Phase와 함께 판단
- 문자 재처리(`useFailback`) — 문자서비스를 추가 계약하는 경우에 한함

---

## 7. 데이터 모델 (신규)

```prisma
// 알림톡 발송 큐 겸 이력. 견적서 외 용도(상담·리뷰)로도 쓰므로 QuoteDelivery와 분리한다.
model AlimtalkMessage {
  id            String    @id @default(cuid())   // 그대로 비즈톡 msgIdx 로 사용 (25자 ≤ Text(40))
  templateKey   String                     // 코드 내부 식별자 (QUOTE_DELIVERED 등)
  templateCode  String                     // 승인된 tmpltCode
  recipient     String                     // 암호화 저장 (src/lib/pii.ts)
  message       String                     // 치환 완료된 최종 본문
  buttons       Json?                      // attach.button[]
  userId        String?
  refType       String?                    // "quote" | "consult" | "review"
  refId         String?
  status        String    @default("PENDING") // PENDING | SENDING | ACCEPTED | SENT | FAILED
  responseCode  String?                    // 접수 결과 (1000 = 접수 성공)
  resultCode    String?                    // 실제 전송 결과 (1000 = 도달)
  sendType      String?                    // K 카카오 | E 결과미수신
  uid           String?                    // 비즈톡 메시지 ID
  failReason    String?
  attempts      Int       @default(0)
  leaseToken    String?                    // 릴레이 클레임 토큰 (스크래퍼 잡과 동일 방식)
  claimedAt     DateTime?
  sentAt        DateTime?
  resultAt      DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status, createdAt])
  @@index([userId, createdAt])
  @@index([refType, refId])
}
```

**`msgIdx` 를 따로 두지 않고 `id`(cuid)를 그대로 쓴다.** 그래서 리스 만료로 같은 행을 재발송하더라도 `msgIdx`가 같아 비즈톡이 중복(`3012`)으로 걸러낸다 — **고객에게 카톡이 두 번 가는 일이 구조적으로 생기지 않는다.** 영구 실패 후의 의도적 재발송은 새 행(= 새 `msgIdx`)으로 만든다.

`recipient` 는 암호화 저장하되 **클레임 응답에서는 앱이 복호화해 평문으로 릴레이에 넘긴다.** 어차피 `message` 본문에 고객명·차량이 평문으로 들어 있어 릴레이에서만 번호를 복호화하는 것은 일관성 없는 복잡도다. 대신 **릴레이에는 `PII_ENCRYPTION_KEY` 를 두지 않는다**(수집 워커와 다른 점).

`QuoteDelivery.channel` 에 `"alimtalk"` 값을 추가해 기존 견적 전송 이력과 연결한다.

---

## 8. 결과코드 대응표 (운영에 필요한 것만)

**접수 응답 `responseCode`** — 즉시 확인

| 코드 | 의미 | 대응 |
|---|---|---|
| `1000` | 접수 성공 | 결과 대기 |
| `B199` | 인증 실패 | `msg`가 `UnregistedIpAddress...`면 **IP 등록 문제**, `Token is empty`면 토큰 누락 |
| `B203` | JSON 형식 오류 | Content-Type / 본문 점검 |
| `B215` | 1분 14회 초과 | 백오프 후 재시도 |
| `B210`/`B211`/`B213` | BS 계정 문제 | 비즈톡 문의 (재시도 무의미) |
| `B301` | 여신건수 초과 | 충전/정산 확인 — **즉시 알림 필요** |

**전송 결과 `resultCode`** — 폴링으로 수신

| 코드 | 의미 | 대응 |
|---|---|---|
| `1000` | 전송 성공 | 완료 |
| `1003` | 발신 프로필 키가 유효하지 않음 | 릴레이 `.env` 의 `BIZTALK_SENDER_KEY` 와 센터의 발신프로필 상태 확인 (재시도 무의미) |
| `3015` | 템플릿을 찾을 수 없음 | 미승인/휴면 템플릿. **휴면 해제**는 센터에서 |
| `3016`/`3027`/`3028` | 본문·버튼·강조표기 불일치 | 코드의 템플릿 빌더 수정 (재시도 무의미) |
| `3018` | 최근 7일간 카톡 미사용 | 문자 폴백 또는 다른 경로 |
| `3019` | 톡 유저 아님 | 문자 폴백 |
| `3020` | 알림톡 수신 차단 | 재시도 금지, 기록만 |
| `3008` | 전화번호 오류 | 번호 정규화 로직 점검 |
| `3012` | msgIdx 중복 | 생성 로직 버그 — 즉시 알림 |
| `1030` | 잘못된 파라미터 / 버튼 링크 무효 | 링크 생성 로직 점검 (미치환 변수 확인) |
| `3005`/`ME09` | 수신 불확실 | 실패로 단정하지 않음. 재발송 시 중복 위험 |
| `3006`/`9998`/`9999` | 시스템 오류 | 재시도 대상 |

---

## 9. 환경변수 (신규)

```
# 앱 (Vercel)
ALIMTALK_ENABLED=true
ALIMTALK_RELAY_SECRET=                # 앱 ↔ 릴레이 공유 시크릿 (Bearer)
ALIMTALK_TEMPLATE_QUOTE_DELIVERED=    # 승인된 템플릿 코드
ALIMTALK_TEMPLATE_CONSULT_RECEIVED=
ALIMTALK_TEMPLATE_REVIEW_REQUEST=
ALIMTALK_TEMPLATE_SIGNUP_COMPLETED=

# 릴레이 (VPS, Vercel에는 두지 않음)
APP_BASE_URL=https://www.imdealer.co.kr
ALIMTALK_RELAY_SECRET=                # 위와 동일한 값
BIZTALK_BSID=
BIZTALK_PASSWD=
BIZTALK_SENDER_KEY=                   # 발신프로필키
BIZTALK_API_HOST=https://www.biztalk-api.com
BIZTALK_TEST_MODE=false               # true면 sendAlimTalkTF(테스트번호 전용)로 발송
```

> **BS ID/PW/발신프로필키는 Vercel에 두지 않는다.** 어차피 릴레이 IP에서만 유효하고, 노출 범위를 줄이는 편이 낫다. 앱은 템플릿 코드만 알면 된다.
> 릴레이에는 `DATABASE_URL` 도 `PII_ENCRYPTION_KEY` 도 필요 없다.

---

## 10. 리스크

| # | 리스크 | 대응 |
|---|---|---|
| 1 | 릴레이 다운 = 발송 지연 | 큐가 DB에 있어 **유실은 없고 지연만** 발생. 복구 시 자동으로 이어서 발송. 단일 장애점임은 인지 |
| 2 | 결과 24시간 유실 | 앱 기록 성공 후에만 `ackResultPoll` → 구조적으로 차단. 추가로 폴링 중단 감지 알림(P3-3) |
| 3 | 템플릿 검수 반려/지연 | 1차 배치를 정보성으로 보수적 작성, 조기 제출 |
| 4 | 본문 불일치로 대량 실패(3016) | 템플릿 본문을 코드 단일 소스로 관리, 스테이징 테스트발송 필수 |
| 5 | 테스트 발송도 과금 | 테스트 번호 3개로 제한, 자동 테스트에서 실발송 금지 |
| 6 | 전화번호 미보유 회원 | 카카오싱크 `phone_number` 동의 필요 — 기존 회원은 재동의 전까지 발송 불가 |
| 7 | 채널톡 구축과 범위 중복 | 알림톡=발신(정보성), 채널톡=상담. 브랜드 메시지(광고성)는 양쪽 걸침 → 착수 전 정리 |
| 8 | 사용 안 해도 기본료 청구 | 8월부터 과금. 일정 지연이 곧 비용 |
```

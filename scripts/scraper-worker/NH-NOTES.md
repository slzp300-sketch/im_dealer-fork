# 농협캐피탈(NH) 스크래핑 — 역설계 노트

> 대상: `https://auto.nhcapital.co.kr/estimate/` (2026-09-02 착수)
> BNK-NOTES.md 와 같은 구조. 정찰 결과를 이 문서에 채워 어댑터 작성·유지보수 근거로 삼는다.
> 정찰 도구: `inspect-capital.mjs` (사람이 직접 로그인 → 견적내기 동안 내부 API 전량 캡처).

## 정찰 절차 (워커 PC 또는 로그인 가능한 PC)

```bash
# 사람이 직접 로그인 + 견적 1건을 끝까지 낸 뒤 터미널 Enter → %TEMP%\nh-recon.json 저장
node scripts/scraper-worker/inspect-capital.mjs https://auto.nhcapital.co.kr/estimate/est/login.nh nh-recon.json
```

## 로그인 — (1단계 정찰 결과, 자격증명 불필요 관찰)

- 로그인 URL: `https://auto.nhcapital.co.kr/estimate/est/login.nh` — 견적 전용 포털
- ID 셀렉터: `input[name="HMPG_LOGIN_ID"]` (placeholder "아이디")
- PW 셀렉터: `#HMPG_PW` (placeholder "비밀번호")
- 로그인 버튼: `<button onclick="doLogin('pc')">로그인</button>`
- **키보드보안: nProtect (nppfs) — 헤드풀(사람 로그인) 필수, 자동 타이핑 불가**
- **2차 인증: 인증번호 6자리** (`input[name="authNumber"]`, `<button onclick="checkAuthNumber()">인증번호 확인</button>`)
- 결론: **BNK/ORIX형 자동 리플레이 불가 → 사람 로그인 후 세션 확보 방식.**
  견적 계산이 내부 JSON API 면 로그인 세션(쿠키)만 유지하고 API 리플레이,
  DOM 렌더링이면 헤드풀 유지하며 화면 조작. → **아래 견적 API 캡처로 판별.**

## 견적 메뉴 / 내부 API — (2단계 정찰 결과 기입 예정)

- [ ] 장기렌트 / 오토리스 메뉴 경로:
- [ ] 브랜드→모델→트림 콤보가 API(JSON)인지 DOM인지:
- [ ] 트림별 차량가·색상 조회 방법:
- [ ] 표준조건(계약기간·약정거리·선납·보증금) 입력 파라미터:
- [ ] 월납입금 계산 호출 (요청/응답 캡처, 엔드포인트·파라미터·응답 인코딩):
- [ ] 잔가율(회수율) 존재 여부와 조회 방법:

## 표준 조건 (기존 어댑터와 동일 규칙)

- 국산/수입 표준 goodsCode·takeType: (캡처 후 확정)
- 계약 36개월 / 약정 2만km / 만기선택 / 정비 제외 기준값으로 검증

## 어댑터 등록 체크리스트 (구현 단계)

- [ ] `adapters/nh.ts` — `SiteAdapter` 구현
- [ ] `adapters/registry.ts` — `NH` 등록 + `inferAdapterFromUrl` 에 `nhcapital` 호스트 추가
- [ ] `src/lib/scraper/connections.ts` — 로그인 URL·`requiresHuman` true 등록
- [ ] 브랜드 목록 (`nh-brands.ts` + `capital-brands.ts`)
- [ ] `try-config.nh.example.json` 작성 → 단독 검증
- [ ] seed 상 NH농협캐피탈 제휴 금융사 등록 여부 확인 (등록돼 있으면 스크래퍼 연결만)

## 1차 정찰 결과 (2026-09-02) — 로그인 흐름만 확인, 견적 미도달 ⚠️

`nh-recon.json`(24콜) 분석 결과, **로그인·인증만 캡처되고 견적은 못 냈다.** `endedBy: browser-closed`, `finalUrl: .../login.nh` (로그인 페이지에서 종료). 후반 시도가 **"비밀번호 분실 처리되었습니다. 담당자에게 문의하세요."** → 계정 비번 잠김.

확인된 사실(유용):

- **견적 흐름은 JSON AJAX** — auth도 `POST /estimate/ajax/EST***.nh` 가 `application/json`. 로그인 세션(쿠키)만 확보하면 **리플레이 방식 어댑터 가능**(BNK/ORIX형).
- 인증 흐름 엔드포인트:
  - `EST101M.nh` — **로그인**. reqBody 는 nProtect 암호화(`__E2E_RESULT__`, `__E2E_UNIQUE__`, `HMPG_PW__E2E__`). 성공 응답: `LOGIN_SCS_YN:"Y"`, `RNCA_AUTH_YN`, `DPT_NM`, `CRTF_SQNO_S30`. 실패 응답: `LOGIN_SCS_YN:"N"` + `LOGIN_ERR_MSG`(예: "비밀번호 분실 처리…").
  - `EST102.nh` — **SMS 2차 인증**. req `{TRX_SQNO_S30, SMS_CRTF_NO_S6(6자리), USERID}`.
  - `EST103.nh` — 인증 시퀀스 확정 `{HMPG_LOGIN_ID}` → `CRTF_SQNO_S30`.
- 어댑터 로그인 성공/실패 판정은 EST101M 응답의 `LOGIN_SCS_YN`으로. (login=사람이 nProtect 입력, 어댑터는 응답으로 성공 감지 후 세션 유지)

### 🚫 블로커 & 재정찰 필요

견적 API(브랜드·모델·트림·조건·월납입금 계산)가 **하나도 안 잡혔다.** 어댑터 작성 불가. 다음이 필요:

1. **NH 계정 비번 잠금 해제** (담당자 문의/재설정 — 현재 "분실 처리" 상태).
2. **깨끗한 재정찰**: 로그인 성공 → **견적 1건을 끝까지** (브랜드→모델→트림→조건→월납입금까지) 낸 뒤 **터미널에서 Enter**(브라우저 닫지 말 것)로 저장.
   ```
   node scripts/scraper-worker/inspect-capital.mjs https://auto.nhcapital.co.kr/estimate/est/login.nh nh-recon.json
   ```
3. 그 nh-recon.json 을 다시 분석 → 견적 엔드포인트/파라미터 확정 → `adapters/nh.ts` 작성.

## 메모

- 계정 79208611. 비번 재설정 후 재정찰 재시도 예정.

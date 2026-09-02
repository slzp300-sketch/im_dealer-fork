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

## 메모

- (정찰하며 채운다)

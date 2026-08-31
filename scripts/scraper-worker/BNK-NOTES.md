# BNK캐피탈 스크래핑 — 역설계 노트 (정찰 진행 중)

> 대상: `https://web.bnkcapital.co.kr/` (2026-08-31 착수)
> ORIX-NOTES.md 와 같은 구조로, 정찰 결과를 이 문서에 채워 어댑터 작성·유지보수의 근거로 삼는다.
> 정찰 도구: `inspect-login.mjs` / `inspect-postlogin.mjs` / `inspect-quote.mjs` /
> `inspect-flow.mjs` / `inspect-api.mjs` (자격증명은 워커 PC `.env` 의
> `SCRAPER_TEST_USER`/`SCRAPER_TEST_PASS`).

## 정찰 절차 (워커 PC에서 실행)

```bash
# 1) 로그인 페이지 관찰 — 자격증명 불필요. 셀렉터·키보드보안 흔적 덤프
node scripts/scraper-worker/inspect-login.mjs https://web.bnkcapital.co.kr/

# 2) (로그인 성공 후) 메뉴·프레임 구조
node scripts/scraper-worker/inspect-postlogin.mjs

# 3) 견적 화면 흐름·내부 API 호출 관찰
node scripts/scraper-worker/inspect-flow.mjs
node scripts/scraper-worker/inspect-api.mjs
```

## 로그인 — (정찰 결과 기입)

- [ ] 실제 로그인 페이지 URL (web.bnkcapital.co.kr 이 일반 홈이면 딜러/제휴점 전용 포털 URL 확인)
- [ ] ID/PW 셀렉터:
- [ ] 로그인 버튼 셀렉터 / 호출 함수:
- [ ] 키보드보안 흔적 (nProtect / RaonSecure / TouchEn / 캡차): → **없으면 ORIX 형, 있으면 헤드풀 형**
- [ ] 2차인증 (SMS/앱):
- [ ] 로그인 성공 시 이동 URL:

## 견적 메뉴 / 내부 API — (정찰 결과 기입)

- [ ] 장기렌트 / 오토리스 메뉴 경로:
- [ ] 브랜드→모델→트림 콤보가 API(JSON)인지 DOM인지:
- [ ] 트림별 차량가·색상 조회 방법:
- [ ] 잔가율(회수율) 그리드 존재 여부와 조회 방법:
- [ ] 월납입금 계산 호출 (요청/응답 캡처):

## 어댑터 등록 체크리스트 (구현 단계)

- [ ] `adapters/bnk.ts` — `SiteAdapter` 구현
- [ ] `adapters/registry.ts` — `BNK` 등록 + `inferAdapterFromUrl` 에 `bnkcapital` 호스트 추가
- [ ] `src/lib/scraper/connections.ts` — 로그인 URL·`requiresHuman` 확정 후 등록
- [ ] `src/lib/scraper/bnk-brands.ts` + `capital-brands.ts` 등록
- [ ] `try-config.bnk.example.json` 작성 → `SCRAPER_TRY_AUTO=1 pnpm scraper:try` 단독 검증
- [ ] 표준 조건은 `src/lib/scraper/standard-conditions.ts` 기본값 사용

## 메모

- seed 기준 BNK캐피탈은 제휴 금융사(code `BNK`, surchargeRate 0.2)로 이미 등록돼 있음 — 금융사 추가 작업은 불필요, 스크래퍼 연결만 하면 됨.

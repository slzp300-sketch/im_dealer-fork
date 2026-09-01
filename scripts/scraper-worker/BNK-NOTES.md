# BNK캐피탈 스크래핑 — 역설계 노트 (정찰 진행 중)

> 대상(파트너 로그인): `https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01` (2026-08-31 착수)
> ⚠️ `web.bnkcapital.co.kr/` 루트는 일반 고객 홈(로그인 폼 없음). 딜러 견적은 위 **파트너(prtn) 로그인** 경로에서 로그인·진행한다.
> ORIX-NOTES.md 와 같은 구조로, 정찰 결과를 이 문서에 채워 어댑터 작성·유지보수의 근거로 삼는다.
> BNK 는 로그인·견적이 한 SPA 안에서 이뤄져 ORIX용 inspect 스크립트(하드코딩)를 쓸 수 없다.
> 대신 `inspect-bnk.mjs`(수동 로그인+견적 중 내부 API 캡처)로 정찰한다.

## 정찰 절차 (워커 PC에서 실행)

```bash
# 브라우저가 파트너 로그인으로 뜬다(기본 URL 고정). 직접 로그인 → 견적 한 바퀴 →
# cmd 로 돌아와 Enter → %TEMP%\bnk-recon.json 에 내부 API 호출이 저장된다.
node scripts/scraper-worker/inspect-bnk.mjs
# (다른 URL 로 보려면 인자로 덮어쓴다)
# node scripts/scraper-worker/inspect-bnk.mjs https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01
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

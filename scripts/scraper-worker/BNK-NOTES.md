# BNK캐피탈 스크래핑 — 역설계 노트 (견적 엔진 해독 완료)

> 대상(파트너 로그인): `https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01`
> 최종 견적 엔진: `https://aict.bnkcapital.co.kr/newcar/estimate/rent`
> ORIX-NOTES.md 와 같은 구조. 정찰 결과를 근거로 어댑터를 작성·유지보수한다.
> BNK 는 로그인·견적이 SPA 안에서 이뤄져 `inspect-bnk.mjs`(수동 로그인+견적 중 내부 API 캡처)로 정찰했다.

## 정찰 절차 (워커 PC에서 실행)

```bash
# 파트너 로그인으로 브라우저가 뜬다(기본 URL 고정, 자동 종료 없음).
# 직접 로그인 → 견적 한 바퀴 → cmd 로 돌아와 Enter → %TEMP%\bnk-recon.json 저장.
# Enter 를 눌러도 창은 유지되므로 로그인 세션을 잃지 않고 여러 번 재캡처 가능.
node scripts/scraper-worker/inspect-bnk.mjs
```

## 로그인 — (정찰 결과)

- 로그인 페이지: `https://web.bnkcapital.co.kr/view/prtn/logn/PrtnLogn010M01` (파트너/딜러 전용)
- **키보드보안 있음**: `keypad`, `TouchEn`, `raon` 흔적 감지 → **헤드풀(사람 로그인) 필수. ORIX형(자동 로그인) 아님.**
- 로그인 관련 내부 API (web.bnkcapital.co.kr/service/api):
  - `login/getLoginInfo.json` → logkey 발급
  - `login/initLogin.json` → `data.tnkSrnd`(키보드보안 세션 난수)
  - `prtn/logn/doLoginAlem.json` / `getServerJobNotiMng.json` → 로그인 처리
  - `prtn/logn/getPrtnLoginInfo.json?partnerCode=60` → 로그인 사용자 정보 확인(`isLogin:true`, userNm/custAgNm/hp/userId)
- 로그인 성공 후: 파트너 메뉴(`cmmn/menu/getPartnerMenuList.json`) 로드 → 견적 메뉴 진입
- 견적 진입 SPA 라우트: `/view/prtn/alem/PrtnAlem510M01`

## 견적 엔진 진입 — token 획득 (핵심)

1. 파트너 포털에서 **견적내기** 진입 → `prtn/alem/mkestm/getEncryptTime.json` **POST** 호출
   - referer: `.../view/prtn/alem/PrtnAlem510M01`
   - 응답에서 **10자리 token** 발급 (예: `NFc7DLd3cf`) — 이번 캡처는 응답 읽기 타이밍이 어긋나 본문 미확보. 재캡처하면 정확한 응답 shape 확인 가능.
2. token 을 들고 견적 엔진 SPA `https://aict.bnkcapital.co.kr/newcar/estimate/rent` 진입
3. 이후 모든 견적 데이터는 **`aict.bnkcapital.co.kr/api/...?token=<token>`** 로 조회 (아래)

> **어댑터 전략(ORIX형 내부 API 리플레이)**: getEncryptTime 의 crypto 를 역설계할 필요 없음.
> 헤드풀 브라우저가 로그인→견적 진입까지 수행하면 페이지가 스스로 token 을 만들어 aict 로 넘긴다.
> 어댑터는 그 **token 을 페이지/URL 에서 읽어와 aict API 를 우리 파라미터로 리플레이**하면 된다.

## 견적 엔진 내부 API — `aict.bnkcapital.co.kr/api` (전부 `?token=` 필수)

응답 인코딩 2종:
- **A형 (카탈로그/설정)**: 응답 body 전체가 `base64(zlib.deflate(JSON))` — brandList/modelList/rentConfig/bnkfg_codes/subsidy/modelData
- **B형 (계산)**: 응답이 `{"rtnData": base64(zlib(JSON)), "returnFunction": "returnCostData(n)"}` — rentRemain/costData. **rtnData 를 한 겹 더 디코드**해야 값이 나온다.

### 카탈로그·설정 (A형)

| 엔드포인트 | 내용 |
|---|---|
| `auto/brandList_local` | 지역(kr/eu/jp/us/cn…)별 브랜드 코드 + `brand{code:{name,logo}}`. 현대=111, 제네시스=112, 기아=121, 쉐보레=131, KG모빌리티=141 등 |
| `auto/modelList_search` | **전체 모델 카탈로그**(≈170KB). `brand{code:{modelList}}`, `model{idx:{name,brand,cartype,priceMin/Max,engine,...}}`, cartype/engine/recommend/popularity 인덱스 |
| `auto/modelList_special` | 특수(리무진/승합 등) 브랜드·모델. `brandApply{hanafn/bnkcap/woorifc}` 로 금융사별 취급 구분 |
| `auto/modelData_<modelIdx>` | **모델 상세**: `lineup{연식·트림 그룹}`, `trim{id:{name,price,tax,option,...}}`, `colorExt`/`colorInt`(코드·RGB), `option`, spec/문서 |
| `auto/rentConfig` | 렌트 공통 옵션 코드표: `month`(12/24/36/48/55/60), `km`(5천~무제한), 블랙박스(BB), 썬팅(FT/S_OBJ), 보험(insureAge/Obj/Car/Self/Emp), endType(만기반납C0501/인수C0502/선택C0504), 탁송(deliveryComp/Ship/Sido), takeType 등 |
| `finance/bnkfg_codes` | **BNK 금융 매핑표**(≈52KB): `brandUse`(브랜드→`brandCM` 예 111→B5701, 112→B57153, 121→B5702), goodsCode, payLimitSet, feeLimitSet, deliveryShipCost(탁송료), 각종 use/set 플래그 |
| `auto/subsidyFinance_YYYYMM` | 전기·수소차 보조금표(국고 ZZ / 지자체 ZC), trim→보조금코드 매핑 |
| `finance/bnkfg_codes` 내 `deliveryShipCost` | 모델별 탁송료(`set` 값) |

### 잔가율(회수율) 그리드 — `bnkfg/rentRemain` (B형)

- 쿼리: `goods=rent&token&brandCM&trimCM&deliveryShip&takeType&goodsCode`
- 디코드 결과 `remain[month][km] = 잔가율%`. 예(디올뉴아반떼):
  - 36개월: 5천km=74, 2만km=70, 무제한=50
  - 48개월: 2만km=63 / 60개월: 2만km=56
  - `remainAdd`(만기인수형 가산), `careType`(정비상품 BNK VIP/Special/정비제외) 포함

### 월납입금 계산 — `bnkfg/costData` (B형) ★최종값

- 기간별로 `fNo=1/2/3` (month=36/48/60) 각각 1콜.
- 쿼리 파라미터(실측, rent 기준):
  ```
  fNo, goods=rent, token, goodsCode=LT201,
  brandCM=B5701, modelCM=DA111, lineupCM=DA11896, trimCM=DAR10574272027,
  colorExt=12691, colorInt=11948, colorExtPrice=0, colorIntPrice=0, optionPrice=0,
  priceBase=23980000, priceSum=23980000,
  deliveryMaker=86000, discountMaker=0, subsidyNation=0, subsidyLocal=0, subsidy=0,
  takeType=LC1110, buyType=A1901,
  insureAge=LC4010, insureObj=LD2023, insureCar=LD2033, insureSelf=300000, insureEmp=LD9000002,
  deliveryType=10, deliveryComp=1345422, deliveryShip=LD4000003, deliverySido=LD5000001,
  endType=C0504, month=36, km=20000,
  prepay=0, deposit=0, depositStock=0,
  remainR=70, remain=16786000,   ← rentRemain 그리드에서 (month,km) 로 뽑아 넣음
  careType=MG15080105
  ```
- 응답(rtnData 디코드): `cost = { pmtSupply, pmtVat, pmtPay, pmtGrand, feeAg, feeAgR }`
  - **`pmtGrand` = 월납입금(부가세 포함)** = pmtSupply + pmtVat.
  - 실측: 36개월 416,900 / 48개월 393,200 / 60개월 377,900 (2만km, 만기선택형, 정비제외)

## goodsCode 파생 규칙 (bnkfg_codes.goodsCode) ★어댑터 핵심

goodsCode(=상품코드, costData/rentRemain 필수)는 **상품(렌트/리스) × 국산/수입 × 명의(개인/개인사업자/법인) × 거래유형(특판/대리점/선구매/기타)** 로 결정된다.
`map` 값(LTxxx)이 실제 URL 에 들어가는 goodsCode 다.

| 조건 | 코드 | map(goodsCode) |
|---|---|---|
| 렌트 국산 개인 특판 | RDPS | **LT201** |
| 렌트 국산 개인 대리점 | RDPD | LT203 |
| 렌트 국산 개인 선구매 | RDPF | LT202 |
| 렌트 국산 개인사업자 특판 | RDBS | LT204 |
| 렌트 국산 법인 특판 | RDCS | LT207 |
| 렌트 수입 개인 특판 | RIPS | **LT210** |
| 렌트 수입 개인 대리점 | RIPD | LT212 |
| 렌트 수입 개인 선구매 | RIPF | LT211 |
| 렌트 수입 개인사업자 특판 | RIBS | LT213 |
| 렌트 수입 법인 특판 | RICS | LT216 |
| 리스 국산 운용 당사/이용자 | LDCD/LDUD | ALOD03/ALODC03 |
| 리스 수입 운용 당사/이용자 | LICD/LIUD | ALO03/ALOC03 |

> 우리 서비스 표준(개인·특판)이면 **국산=LT201, 수입=LT210**. (전체 표는 recon JSON `bnkfg_codes.goodsCode` 참조)

## brandCM 매핑 (bnkfg_codes.brandUse[brandCode].map) — 실측 확인

| 브랜드(코드) | brandCM |
|---|---|
| 현대(111) | B5701 |
| 기아(121) | B5702 |
| BMW(211) | B5706 |
| 테슬라(441) | B57B4 |

- modelCM = `DA` + brandCode (예 현대 → DA111), lineupCM = `DA` + modelIdx (예 DA11896), trimCM = `DAR` + trimId + 연식 (예 DAR1057427 + 2027).

## 검증용 실측 견적 (2만km · 만기선택형 · 정비제외) — 어댑터 회귀 테스트 기준

| 브랜드 | 모델 | goodsCode | 차량가 | 36개월 | 48개월 | 60개월 |
|---|---|---|---|---|---|---|
| 현대(국산) | 디올뉴아반떼 | LT201 | 23,980,000 | 416,900 | 393,200 | 377,900 |
| 기아(국산) | 더뉴모닝 | LT201 | 14,210,000 | 324,300 | 300,000 | 289,000 |
| 테슬라(수입) | New Model 3 | LT210 | 46,990,000 | 987,700 | 884,000 | 819,800 |

- (참고) BMW iX2 는 견적을 끝까지 완성하지 않아 `pmtGrand=null` — 버그 아님, 입력 미완성.

## 어댑터 등록 체크리스트 (구현 완료 — 실사이트 검증만 남음)

- [x] `adapters/bnk.ts` — `SiteAdapter` 구현 (헤드풀 로그인 → 견적 진입 → token 낚아채기 → aict API 리플레이)
- [x] `adapters/registry.ts` — `BNK` 등록 + `inferAdapterFromUrl` 에 `bnkcapital` 호스트 추가
- [x] `src/lib/scraper/connections.ts` — 로그인 URL(`PrtnLogn010M01`)·`requiresHuman: true`·`catalogOnly: true` 등록
- [x] `src/lib/scraper/bnk-brands.ts` + `capital-brands.ts` — 국산 전량 + 주요 수입 등록
- [x] 값 계산: brandCM=`bnkfg_codes.brandUse[code].map`, 잔가=`rentRemain.remain[month][km]`, 월납입금=`costData.cost.pmtGrand`
- [x] `try-config.bnk.example.json` + `try-adapter.ts` 에 `mode:"catalog"` 검증 경로 추가
- [x] 표준 조건: 국산=특판(LT201/LC1110), 수입=비제휴/대리점(LT212/LC1120) — standard-conditions 준수
- [x] `adapters/bnk.test.ts` — 응답 디코더(raw / rtnData 래핑 / HTML만료 / 압축폭탄 상한) 단위 테스트
- [ ] **실사이트 단독 검증(워커 PC)**: `try-config.bnk.example.json` → `try-config.json` 복사 후 헤드풀 `pnpm scraper:try`
      → 안내대로 로그인 + 견적내기 진입 → 현대 아반떼(11896) `36_20000=416900 / 48=393200 / 60=377900` 확인

## 코드 파생 규칙 요약 (어댑터 구현 근거)

- `modelCM` = `"DA" + brandCode` (예 현대 111 → DA111)
- `lineupCM` = `"DA" + modelIdx` (예 DA11896)
- `trimCM` = `"DAR" + trimId + 연식4자리` (예 트림 1057427·2027 → DAR10574272027)
- `brandCM` = 런타임 `bnkfg_codes.brandUse[brandCode].map`
- `deliveryMaker`/`deliveryShip` = `bnkfg_codes.deliveryShipCost[modelId]`(있으면 .set/.map) 없으면 modelData `model.deliveryShip` → `rentConfig.deliveryShip` 이름 매칭. 수입=LD4999999
- `deliveryComp` = `rentRemain` 응답의 `deliveryComp`
- 색상 = modelData `colorExt`/`colorInt` 각 첫 항목(기본색)
- EV 보조금 = 0 (우리 시스템 관례, WOORIFC 와 동일)

## 메모

- seed 기준 BNK캐피탈은 제휴 금융사(code `BNK`, surchargeRate 0.2)로 이미 등록돼 있음 — 금융사 추가 불필요, 스크래퍼 연결만 하면 됨.
- token 은 세션·시간에 종속되는 단기 토큰으로 보임(getEncryptTime = "암호화 시각"). 어댑터는 매 실행마다 새 token 을 페이지에서 확보해야 함(하드코딩 금지).
- 응답 base64+zlib 은 한 글자만 잘려도 디코드가 깨진다 → `inspect-bnk.mjs` 는 응답 본문을 자르지 않도록 수정 완료(커밋 26f24bb).
- 로그인 계정은 파트너(partnerCode=60, 예 "신준호/(주)바른"). 실제 어댑터 자격증명은 try-config 로 주입.

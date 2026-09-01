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

## 어댑터 등록 체크리스트 (구현 단계)

- [ ] `adapters/bnk.ts` — `SiteAdapter` 구현 (헤드풀 로그인 → 견적 진입 → token 확보 → aict API 리플레이)
- [ ] `adapters/registry.ts` — `BNK` 등록 + `inferAdapterFromUrl` 에 `aict.bnkcapital.co.kr` / `web.bnkcapital.co.kr` 호스트 추가
- [ ] `src/lib/scraper/connections.ts` — 로그인 URL(`PrtnLogn010M01`)·`requiresHuman: true`(키보드보안) 등록
- [ ] `src/lib/scraper/bnk-brands.ts` + `capital-brands.ts` — brandList_local 의 `brand{code:name}` 로 매핑
- [ ] 값 계산: brandCM 은 `bnkfg_codes.brandUse[brandCode].map`, 잔가는 `rentRemain.remain[month][km]`, 월납입금은 `costData.cost.pmtGrand`
- [ ] `try-config.bnk.example.json` 작성 → `SCRAPER_TRY_AUTO=1 pnpm scraper:try` 단독 검증
- [ ] 표준 조건은 `src/lib/scraper/standard-conditions.ts` 기본값 사용

## 메모

- seed 기준 BNK캐피탈은 제휴 금융사(code `BNK`, surchargeRate 0.2)로 이미 등록돼 있음 — 금융사 추가 불필요, 스크래퍼 연결만 하면 됨.
- token 은 세션·시간에 종속되는 단기 토큰으로 보임(getEncryptTime = "암호화 시각"). 어댑터는 매 실행마다 새 token 을 페이지에서 확보해야 함(하드코딩 금지).
- 응답 base64+zlib 은 한 글자만 잘려도 디코드가 깨진다 → `inspect-bnk.mjs` 는 응답 본문을 자르지 않도록 수정 완료(커밋 26f24bb).
- 로그인 계정은 파트너(partnerCode=60, 예 "신준호/(주)바른"). 실제 어댑터 자격증명은 try-config 로 주입.

# IM캐피탈(IM, 옛 DGB캐피탈) 스크래핑 — 역설계 노트

> 대상: (파트너 포털 로그인 URL — 확인 필요)
> NH-NOTES.md / BNK-NOTES.md 와 같은 구조. 정찰 결과를 이 문서에 채워 어댑터 작성·유지보수 근거로 삼는다.

## 정찰 절차

로그인 보안(키패드/2차인증)이 있어 자동 타이핑이 막히면 **사람이 직접 로그인 → 견적 1건**을 내는 동안 내부 API 를 캡처한다.

- **신규 캡처(브라우저 새로 띄움)**:
  ```bash
  node scripts/scraper-worker/inspect-capital.mjs <로그인URL> im-recon.json
  ```
- **이미 로그인해 둔 디버깅 Chrome 에 attach**(재로그인 없이 이어서):
  ```bash
  node scripts/scraper-worker/attach-capital.mjs http://127.0.0.1:9222 <IM호스트> im-recon.json
  ```
  → 사람이 견적을 끝까지 낸 뒤, 캡처본(%TEMP%\im-recon.json)을 분석.

## 로그인 — (정찰 전, 미확인)

- 로그인 URL: **(확인 필요)**
- ID/PW 셀렉터: (캡처 후)
- 키보드보안(nProtect/RaonSecure/TouchEn 등): (확인 필요) → 있으면 헤드풀 사람 로그인(requiresHuman=true)
- 2차 인증(SMS 등): (확인 필요)
- 로그인 성공/실패 판정 근거: (캡처 후)

## 견적 엔진 — **BNK aict 엔진과 동일** (2026-09-04 정찰 확인) ✅

- **견적 엔진 도메인: `auto.dgbcap.com`** (로그인 포털 www.imcap.co.kr 과 별개). 견적 페이지 `https://auto.dgbcap.com/newcar/estimate/rent` — BNK `aict.bnkcapital.co.kr/newcar/estimate/rent` 와 **동일 경로·동일 API 구조**.
- 로그인 흐름: www.imcap.co.kr `/admin/dgbLoginAjax.do` (loginInfoAjax→generate→getAuthData→phoneAuthCode→phoneAuthCodeCheck = **SMS 인증**) → 견적내기 시 auto.dgbcap.com 으로 `?token=` 발급. **BNK 처럼 token 낚아채 리플레이**.
- **응답 인코딩: base64+zlib(deflate)**, `{rtnData}` 래핑은 한 겹 더 디코드 — **BNK `decodeBnkResponse` 그대로 사용 가능**.
- 엔드포인트(전부 `GET https://auto.dgbcap.com/api/...?token=`):
  - `/api/auto/brandList_local` — 국가별 브랜드(111 현대·112 제네시스·121 기아·131 쉐보레·151 르노삼성 …)
  - `/api/auto/modelList_search` — 브랜드→모델ID 목록 + 모델명 (BNK `modelList_search` 동일)
  - `/api/auto/modelData_{모델ID}` — 라인업·트림·가격·색상
  - `/api/finance/dgbcap_codes` — 금융 코드표(아래 표준조건 코드 출처) ※ BNK `bnkfg_codes` 대응
  - `/api/finance/dgbcap_rentD` / `dgbcap_rentI` — 국산/수입 렌트 config(이율·잔가 테이블) ※ BNK `rentConfig` 대응(국산/수입 분리)
  - `/api/finance/dgbcap_dealer` — 대리점 코드
  - `/api/auto/discountData_{YYYYMM}_{brandCd}` — 제조사 할인
  - **(미확인) costData / rentRemain** — 월납입금 계산. BNK 는 `/api/bnkfg/costData`·`/api/bnkfg/rentRemain`. IM 접두 확정 필요(견적 완료 캡처).

### 표준 조건 코드 — dgbcap_codes 실측 (일부 확정, 나머지 견적 캡처 대기)

`dgbcap_codes` 의 각 코드객체 `{name, map, set}`. costData 에 보내는 값(BNK 는 `.map` 계열)·표준 조합은 **실제 costData 요청**에서 확정.

- **goodsKind `R`** = 장기렌트 (map IC260003). L=운용리스, K=할부.
- **buyType `PU`** = 개인 (map CA02115). PB=개인사업자, CB=법인.
- **endType `C`** = 반납/인수 선택형(=만기선택, set "RLV"). B=조기반납, G=인수형.
- **careType `Self`** = 정비제외 (map LFB810). Select=LFB820, Premium=LFB830.
- **brandCM = `brandCode[brandCd].map`** — 현대 LF74HDM·제네시스 LF74AC5·기아 LF74KIA·쉐보레 LF74KGM·르노삼성 LF74RSM.
- **goodsCode**(미확정): 장기렌트 후보 RT(인수형 렌터카 512003011)·RG(오토렌탈 일반 512003001)·RK(할부형)·RS(자체잔가). ← 어느 게 표준인지 costData 캡처로 확정.
- deliveryType: MD(제조사+외주)·BD(제조사)·OD(외주). takeSido: DG(대구)·SU(서울)·BS(부산).
- **미확인**: modelCM/lineupCM/trimCM 코드 형식(BNK 는 DA·DAR 접두), 잔가율 출처.

### ★ 월납입금 = **클라이언트(JS) 계산** — BNK 와 결정적 차이 (2026-09-04 확정)

- **서버 costData/rentRemain 호출이 없다.** 트림 클릭·계산 시 auto.dgbcap.com 으로 나가는 계산 API 요청 0건(리스너 90초 확인). `/api/finance/dgbcap_costData` 는 200 이지만 `{"result":"failure","error":"404"}`(존재하지 않는 데이터키 → finance 라우트 일반 실패). BNK 처럼 서버 pmtGrand 리플레이 **불가**.
- 월납입금은 **`calculator-2.5.0.min.js`(178KB)가 브라우저에서 계산**한다. 함수군: `calculator()`(메인)·`calculatorRent()`·`calculatorPMT()`·`calculatorCost()`·`calculatorFince()`·`calculatorPrice()` 등. 출력 핵심 = **`pmtGrand`(월 렌트료, VAT포함)** — 기간별로 산출해 DOM 결과표(`#estmBody .estmCell`)에 렌더.
- 상태 전역: **`estmData["1"]`**(차량 선택 — trim/price/color/option/fee 61필드), **`estmCfg`**(조건 — month1/2/3, km, endType, careType, buyType, issueType…), **`estmRslt`**(차량단위 결과 vehicleSale/Supply/Free). 기간별 월 렌트료는 DOM 셀에 렌더(전역 객체엔 차량단위만).
- **잔존가치(잔가율)도 계산 결과에 표시**(예 36개월 66%·48개월 58%·60개월 50%). dgbcap_rentD/rentI 의 이율·잔가 테이블 기반.

### 어댑터 전략 — **JBWOORI형(사이트 계산기 구동)**

1. **카탈로그 열거**: JSON API 로 깔끔하게 — `brandList_local`(브랜드) → `modelList_search`(브랜드→모델ID·모델명) → `modelData_{모델ID}`(라인업·트림·가격·색상). base64+zlib 디코드(BNK `decodeBnkResponse` 재사용).
2. **월납입금**: 서버 리플레이 불가 → **견적 페이지에서 사이트 계산기 구동**. 트림 로드(estmData 세팅 or 사이트 함수) → km(1/2/3만)·기간(36/48/60) 조건 세팅 → `calculator()` 실행 → DOM 결과표에서 기간별 `pmtGrand`(월 렌트료) + 잔존율 읽기. 한 계산이 3기간을 동시 산출 → km 3회 × 트림 = 9칸.
3. 표준조건(estmCfg 실측): buyType `PU`(개인)·careType `Self`(정비제외)·endType `C`(만기선택)·issueType `S`(특판)·insureAge26/obj1/car1/self30·takeSido `DG`·deliveryType `OD`·remain `max`·보증/선납 0.

### 계산 체인 (계측으로 확정)

사용자가 약정거리 드롭다운을 바꾸면 → **`calculator()` 직접 호출**(arrangeEstmData 안 거침) → 체인:
```
calculator() → calculatorPrice() → [기간별] calculatorRent(cfg, month, "0\tcash", 0, "max"(remain), "26"(insureAge), "1", km, endType, delivery, price, supply, "OD", ...) 
  → calculatorPMT(month, rate, cap, rem) ×수십회 (이율 이분법 수렴)
```
- **`calculatorPMT(mon,rate,cap,rem)`**: `rate=rate/100/12; return (cap - rem/(1+rate)^mon) * rate*(1+rate)^mon / ((1+rate)^mon - 1);` = 잔가부 연금(PMT). 단, **월 렌트료 = PMT(금융분) + 보험·정비·탁송·세금 등 원가 다수** → PMT만으론 재현 불가.
- **`calculator()`(15.5KB)는 `#estmBody .estmCell[estmNo=estmNow]` 의 DOM `.selbar[kind=X]` code 속성에서 조건(issueType/buyType/km/endType/care…)을 읽어** 3열(36/48/60) 계산 후 `.fincCell .grand .total .price.num` 에 렌더. estmNow = 활성 컬럼.
- 약정거리 컨트롤 = 컬럼별 `.selsub.fincView` 접이식(`.estmRslt_fincKm` 표시 + `.kmList li[km=1/1.5/2/2.5/3]`). jQuery 델리게이트 바인딩이라 raw `el.click()` 로는 재계산 트리거 실패(실측). km 코드: 1·1.5·2·2.5·3.

### ⚠️ 구동 난제 (미해결)

- 월납입금은 **서버 리플레이 불가(클라 계산) + 원가 컴포넌트 다수라 공식 재현도 위험** → **사이트 계산기 구동**이 정답.
- 하지만 구동 트리거가 까다로움: `arrangeEstmData('km',code)` 직접 호출·`li.click()` 모두 재계산 미발동(estmNow 컨텍스트 + jQuery 이벤트 + `.selbar` code 속성 세팅 필요). **정확한 구동 레시피는 추가 작업 필요**(계측+실동작 대조 또는 좌표 실클릭).
- 카탈로그(브랜드/모델/트림/가격/색상)는 JSON API 로 즉시 가능 — 난제는 월납입금 산출뿐.

### 구동 크래킹 결과 (2026-09-04)

- **UI 컨트롤러 = `estimate-1.6.8.min.js`(141KB)** + `publish-1.7.2.min.js`(드롭다운 open/close) + `calculator-2.5.0.min.js`(계산). 다중 파일 체인.
- **컬럼 조건은 `fincConfig[estmNow][fincNo][key]` 전역 배열에 저장**(km/month/endType/goods/remain). estmNow=1, fincNo=1/2/3 = 36/48/60 컬럼. 차량은 `.estmCell .selbar[kind].attr('code')`.
- 드롭다운 열기 = `$(document).on("click",".selsub > button")` → `getLoanForm(kind,goods)` 가 옵션 리스트 생성. 옵션 클릭 → 값 적용 + `estmChangeKind=kind` + `calculator()`.
- **구동은 됨(재계산 발동 확인)**:
  - dispatchEvent 2단계(버튼→옵션 li 버블 클릭) → 재계산 O, 단 li.on 상태 불일치로 부정확.
  - `fincConfig[en][fn].km=값 + estmChangeKind='km' + calculator()` → 재계산 O, **값 근접하나 오차 ~1%대 + 반복 시 드리프트**(네이티브 전체 체인 일부 누락).
- **⚠️ 정확한 값 재현은 실제 신뢰 클릭 필요**: 부분 JS 주입으론 remain 재해석·파생값 재계산이 누락돼 오차. **CDP `Input.dispatchMouseEvent`(좌표 실클릭)로 네이티브 li 클릭 핸들러를 온전히 태우는 방식**이 정확값 경로(단, 요소 스크롤·좌표 필요, 트림당 수 초, 느림). puppeteer `elementHandle.click()` 은 가시성 대기로 hang 발생 → 미사용.
- 실험이 세션 상태를 오염시킬 수 있음 → 정확 검증은 **견적 페이지 리로드(초기화) 후 깨끗한 1회 구동**으로.

### ✅ 정확값 검증 통과 — CDP 실클릭 (2026-09-04)

**CDP `Input.dispatchMouseEvent`(좌표 실클릭)로 네이티브 UI 핸들러를 온전히 태우면 정확·반복안정(드리프트無).** 부분 JS 주입과 달리 사이트 자체 계산이라 정확.
- 검증(아반떼 모던, 36개월): km2→427,680 / km3→446,050 / km2→427,680(반복 동일) / km3→446,050. **드리프트 0.**
- 네이티브 계산도 세션간 ~300~440원(≈0.1%) 변동 있음(AG/CM 수수료·할인 반올림) — "약정시 확정" 범위, 무시 가능.
- **CDP 실클릭 레시피**:
  ```
  session = page.target().createCDPSession()
  // 요소 scrollIntoView({block:center}) → getBoundingClientRect 중심좌표
  // Input.dispatchMouseEvent(mousePressed)+(mouseReleased) at (x,y)
  // km 변경: [열기] .fincCell .selsub[kind='kmSel'] > button  → 대기 700ms
  //          [선택] .fincCell .selsub[kind='kmSel'] .list li[km='1'|'2'|'3'] button → 대기 ~2.8s(재계산)
  // 읽기: .fincCell .grand .total .price.num
  ```
- **⚠️ 견적 페이지 진입은 포털 토큰 핸드셰이크 필수** — auto.dgbcap.com/newcar/estimate/rent 직접 URL 은 "/"로 튕김. imcap.co.kr 포털 로그인 → 견적내기로 진입해야 token 발급.

### 어댑터 설계 (확정) — 카탈로그 JSON + CDP 실클릭 구동

1. 카탈로그: brandList_local/modelList_search/modelData_{id} (JSON, base64+zlib) — 빠름.
2. 트림별: CDP 실클릭으로 브랜드→모델→라인업→트림 선택(로드) → km 1/2/3 각각 실클릭 → 3열(36/48/60) 월렌트료 읽기 = 9칸. 느리지만(트림당 수십초) 정확. 백그라운드 야간잡 적합.

### ✅ 드라이버 프로토타입 9칸 검증 완료 (아반떼 모던 1057427)

| 개월\약정 | 1만 | 2만 | 3만 |
|---|---|---|---|
| 36 | 415,360(71%) | 427,680(69%) | 446,050(66%) |
| 48 | 393,030(63%) | 402,050(61%) | 415,470(58%) |
| 60 | 378,180(55%) | 385,220(53%) | 395,560(50%) |

- 차량 로드: `pickSelbar(kind, code)` = 실클릭 `.estmCell .selbar[kind] > button`(열기, 800ms) → `.list li[kind='code'] button`(선택, 1200ms). kind=brand/model/lineup/trim 순.
- km: 컬럼(인덱스)별로 `.selsub[kind='kmSel'] > button`(열기,700ms) → `.list li[km='1'|'2'|'3'] button`(선택,2200ms). 3열 모두 세팅 후 읽기.
- 읽기: 컬럼별 `monthSel/kmSel/remainSel` code + `.grand .total .price.num`(월렌트료). baseRates 키 = `${month}_${dist}`(dist=10000/20000/30000).
- 잔존율 monotonic 정상(71/69/66 …). 값은 사이트 네이티브(정확), 세션간 ~0.1% 변동만.

### 검증 기준값 (아반떼 모던 11896/1057427, 23,980,000원, 실측 — 네이티브 UI)

| 기간 | 2만km 월렌트료 | 3만km 월렌트료 | 잔존율(2만/3만) |
|---|---|---|---|
| 36개월 | 427,350 | 445,610 | 69% / 66% |
| 48개월 | 401,830 | 415,140 | 61% / 58% |
| 60개월 | 384,890 | 395,340 | 53% / 50% |

## 어댑터 등록 체크리스트 (구현 단계)

- [ ] `adapters/im.ts` — `SiteAdapter` 구현
- [ ] `adapters/registry.ts` — `IM` 등록 + `inferAdapterFromUrl` 호스트 추가
- [ ] `src/lib/scraper/connections.ts` — 로그인 URL·`requiresHuman` 등록 (이름 매칭 "IM"/"아이엠"/"DGB"/"대구")
- [ ] 브랜드 목록 (`im-brands.ts` + `capital-brands.ts`)
- [ ] `try-config.im.example.json`
- [ ] seed 상 IM캐피탈 금융사(code: "IM") 이미 등록됨 — 스크래퍼 연결만 하면 됨

## 메모

- IM캐피탈 = 옛 DGB캐피탈(대구은행 계열, 2024 iM 리브랜딩). seed 금융사 code: "IM" 등록됨.

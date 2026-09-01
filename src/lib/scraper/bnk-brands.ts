// BNK캐피탈(BNK) 브랜드 코드 — 견적엔진 brandList_local (2026-09 확인).
// 카탈로그 수집 UI 브랜드 선택이 사용한다. 코드는 bnkfg_codes.brandUse 로 brandCM 에 매핑된다.
// 국산(kr) 전량 + 주요 수입(렌트 취급 use=Y 위주). 수입은 standard-conditions 상 '비제휴'(대리점) 처리.
export interface BnkBrand {
  brandCd: string;
  name: string;
}

export const BNK_BRANDS: BnkBrand[] = [
  // 국산 (kr)
  { brandCd: "111", name: "현대" },
  { brandCd: "112", name: "제네시스" },
  { brandCd: "121", name: "기아" },
  { brandCd: "131", name: "쉐보레" },
  { brandCd: "132", name: "GMC" },
  { brandCd: "141", name: "KG모빌리티" },
  { brandCd: "151", name: "르노코리아" },
  // 수입 (주요, 렌트 취급) — brandUse use=Y 확인 브랜드
  { brandCd: "211", name: "BMW" },
  { brandCd: "212", name: "미니" },
  { brandCd: "312", name: "렉서스" },
  { brandCd: "311", name: "토요타" },
  { brandCd: "411", name: "포드" },
  { brandCd: "412", name: "링컨" },
  { brandCd: "441", name: "테슬라" },
];

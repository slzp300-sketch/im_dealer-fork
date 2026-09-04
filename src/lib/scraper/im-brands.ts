// IM캐피탈(IM, 옛 DGB캐피탈) 브랜드 코드 — 견적엔진 brandList_local kr (2026-09-04 확인).
// 카탈로그 수집 UI 브랜드 선택이 사용한다. 코드는 modelList_search 의 브랜드 키와 동일.
// 국산(kr) 전량. 132 GMC 는 렌트 취급 여부 미확정이라 제외(필요 시 추가).
export interface ImBrand {
  brandCd: string;
  name: string;
}

export const IM_BRANDS: ImBrand[] = [
  { brandCd: "111", name: "현대" },
  { brandCd: "112", name: "제네시스" },
  { brandCd: "121", name: "기아" },
  { brandCd: "131", name: "쉐보레" },
  { brandCd: "151", name: "르노삼성" },
];

// 어댑터 코드 → 카탈로그 수집용 브랜드 목록. 신규 캐피탈사는 여기 등록한다.
import { ORIX_BRANDS } from "./orix-brands";
import { WOORIFC_BRANDS } from "./woorifc-brands";
import { SHINHAN_BRANDS } from "./shinhan-brands";
import { JBWOORI_BRANDS } from "./jbwoori-brands";
import { IM_BRANDS } from "./im-brands";

export interface CapitalBrand {
  brandCd: string;
  name: string;
}

const CAPITAL_BRANDS: Record<string, CapitalBrand[]> = {
  ORIX: ORIX_BRANDS,
  WOORIFC: WOORIFC_BRANDS,
  SHINHAN: SHINHAN_BRANDS,
  JBWOORI: JBWOORI_BRANDS,
  IM: IM_BRANDS,
};

/** 어댑터 코드로 카탈로그 브랜드 목록을 얻는다. 미등록이면 빈 배열. */
export function brandsForAdapter(adapter: string | null | undefined): CapitalBrand[] {
  return adapter ? CAPITAL_BRANDS[adapter] ?? [] : [];
}

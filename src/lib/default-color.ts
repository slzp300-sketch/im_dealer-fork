// 견적 기본 색상 선택 — 기본 견적에 색상 추가요금이 몰래 끼어드는 것을 막는다.
// 색상 동기화는 첫 번째 색상을 isDefault 로 찍는 경우가 있고(순서 기반), 수입차 원본
// 데이터는 추가요금 색상이 목록 앞에 오는 경우가 있어(예: 테슬라) 플래그/순서만 믿으면
// 기본 견적이 유료 색상으로 시작한다. 0원 기본(스탠다드) 색상이 하나라도 있으면 그것부터 고른다.

export interface DefaultColorCandidate {
  readonly kind: "EXTERIOR" | "INTERIOR";
  readonly isDefault: boolean;
  readonly priceDelta: number;
}

/**
 * 기본 색상 선택 우선순위 (해당 kind 안에서, 목록 순서대로):
 * 1. isDefault + 추가요금 0원 — 관리자 지정 기본색이 무료인 경우
 * 2. 추가요금 0원인 첫 색상 — 플래그가 유료 색상에 붙어 있어도 무료 색상으로 시작
 * 3. isDefault 플래그 — 무료 색상이 아예 없는 차종(유료 색상만 있는 수입차 등)
 * 4. 해당 kind 의 첫 색상
 */
export function pickDefaultColor<T extends DefaultColorCandidate>(
  colors: readonly T[],
  kind: "EXTERIOR" | "INTERIOR"
): T | undefined {
  const ofKind = colors.filter((c) => c.kind === kind);
  return (
    ofKind.find((c) => c.isDefault && c.priceDelta <= 0) ??
    ofKind.find((c) => c.priceDelta <= 0) ??
    ofKind.find((c) => c.isDefault) ??
    ofKind[0]
  );
}

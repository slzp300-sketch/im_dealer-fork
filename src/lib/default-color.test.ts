import { describe, expect, it } from "vitest";
import { pickDefaultColor, type DefaultColorCandidate } from "./default-color";

type ColorRow = DefaultColorCandidate & {
  readonly id: string;
  readonly name: string;
};

function color(
  id: string,
  name: string,
  priceDelta: number,
  overrides: Partial<DefaultColorCandidate> = {},
): ColorRow {
  return { id, name, kind: "EXTERIOR", isDefault: false, priceDelta, ...overrides };
}

// 테슬라 모델 Y/RWD 색상판 — 동기화가 첫 색상(솔리드 블랙, 유료)에 isDefault 를 붙인 상황.
// 한국 테슬라 기준 표준색(0원)은 펄 화이트 멀티코트다.
const modelYColors: ColorRow[] = [
  color("ext-black", "솔리드 블랙", 1_000_000, { isDefault: true }),
  color("ext-stealth-grey", "스텔스 그레이", 1_000_000),
  color("ext-pearl-white", "펄 화이트 멀티코트", 0),
  color("ext-deep-blue", "딥 블루 메탈릭", 1_000_000),
  color("ext-ultra-red", "울트라 레드", 2_000_000),
];

// 테슬라 모델 S처럼 표준색이 흰색이 아닌 라인업 — 표준색(솔리드 블랙, 0원)이 목록 뒤에 있다.
const modelSColors: ColorRow[] = [
  color("ext-pearl-white", "펄 화이트 멀티코트", 1_500_000),
  color("ext-deep-blue", "딥 블루 메탈릭", 1_500_000),
  color("ext-black", "솔리드 블랙", 0),
  color("ext-ultra-red", "울트라 레드", 2_500_000),
];

describe("pickDefaultColor", () => {
  it("유료 색상이 isDefault 플래그를 갖고 있어도 0원 표준색을 고른다 (모델 Y → 펄 화이트)", () => {
    const picked = pickDefaultColor(modelYColors, "EXTERIOR");
    expect(picked?.id).toBe("ext-pearl-white");
    expect(picked?.priceDelta).toBe(0);
  });

  it("플래그가 아예 없어도(레거시 import) 0원 색상 중 첫 색을 고른다 (모델 S → 솔리드 블랙)", () => {
    const picked = pickDefaultColor(modelSColors, "EXTERIOR");
    expect(picked?.id).toBe("ext-black");
    expect(picked?.priceDelta).toBe(0);
  });

  it("isDefault + 0원 조합이면 목록 앞의 플래그 없는 0원 색보다 우선한다", () => {
    const colors = [
      color("ext-white", "흰색", 0),
      color("ext-silver", "은색", 0, { isDefault: true }),
    ];
    expect(pickDefaultColor(colors, "EXTERIOR")?.id).toBe("ext-silver");
  });

  it("0원 색상이 아예 없으면 isDefault 플래그를 유지한다 (유료 색상만 있는 차종)", () => {
    const colors = [
      color("ext-red", "레드", 2_000_000, { isDefault: true }),
      color("ext-blue", "블루", 1_000_000),
    ];
    expect(pickDefaultColor(colors, "EXTERIOR")?.id).toBe("ext-red");
  });

  it("0원도 플래그도 없으면 첫 색상으로 돌아간다", () => {
    const colors = [
      color("ext-blue", "블루", 1_000_000),
      color("ext-red", "레드", 2_000_000),
    ];
    expect(pickDefaultColor(colors, "EXTERIOR")?.id).toBe("ext-blue");
  });

  it("kind 간섭 없이 EXTERIOR/INTERIOR 각각에서 고른다", () => {
    const colors = [
      color("ext-black", "솔리드 블랙", 1_000_000, { isDefault: true }),
      color("ext-white", "펄 화이트", 0),
      color("int-black", "블랙 인테리어", 0, { kind: "INTERIOR" }),
      color("int-white", "화이트 인테리어", 1_000_000, { kind: "INTERIOR", isDefault: true }),
    ];
    expect(pickDefaultColor(colors, "EXTERIOR")?.id).toBe("ext-white");
    expect(pickDefaultColor(colors, "INTERIOR")?.id).toBe("int-black");
  });

  it("해당 kind 의 색상이 없으면 undefined 를 반환한다", () => {
    expect(pickDefaultColor(modelYColors, "INTERIOR")).toBeUndefined();
    expect(pickDefaultColor([], "EXTERIOR")).toBeUndefined();
  });
});

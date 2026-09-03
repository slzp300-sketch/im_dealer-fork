import { describe, expect, it } from "vitest";
import { isMobileDevice } from "./device";

describe("isMobileDevice", () => {
  const IPHONE =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
  const ANDROID =
    "Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 Mobile";
  const DESKTOP =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120";

  it("아이폰·안드로이드·아이패드 UA 는 모바일로 본다", () => {
    expect(isMobileDevice(IPHONE)).toBe(true);
    expect(isMobileDevice(ANDROID)).toBe(true);
    expect(isMobileDevice("Mozilla/5.0 (iPad; CPU OS 17_0)")).toBe(true);
  });

  it("데스크톱 UA 는 모바일이 아니다", () => {
    expect(isMobileDevice(DESKTOP)).toBe(false);
  });

  it("빈 UA 는 모바일이 아니다(서버 등)", () => {
    expect(isMobileDevice("")).toBe(false);
  });
});

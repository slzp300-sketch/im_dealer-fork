import { describe, expect, it } from "vitest";
import { WORKER_PROTOCOL_VERSION } from "./worker-version";

describe("worker protocol version", () => {
  it("is bumped when claimed jobs start requiring lease tokens", () => {
    expect(WORKER_PROTOCOL_VERSION).toBe(6);
  });
});

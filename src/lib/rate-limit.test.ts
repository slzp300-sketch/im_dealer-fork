import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limiterState = vi.hoisted(() => ({
  limit: vi.fn(),
  slidingWindowCalls: [] as Array<{ tokens: number; window: string }>,
  constructors: [] as Array<{ prefix: string; limiter: { tokens: number; window: string } }>,
}));

vi.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow(tokens: number, window: string) {
      const limiter = { tokens, window };
      limiterState.slidingWindowCalls.push(limiter);
      return limiter;
    }
    static tokenBucket() {
      return {};
    }
    constructor(opts: { prefix: string; limiter: { tokens: number; window: string } }) {
      limiterState.constructors.push({
        prefix: opts.prefix,
        limiter: opts.limiter,
      });
    }
    limit = limiterState.limit;
  },
}));

vi.mock("@upstash/redis", () => ({
  Redis: { fromEnv: () => ({}) },
}));

function request(ip?: string): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (ip) headers.set("x-forwarded-for", ip);
  return new NextRequest("https://example.com/api/quote/save", {
    method: "POST",
    headers,
  });
}

describe("route-level rate limiters (T37/C6)", () => {
  const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
  const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    limiterState.limit.mockReset();
    limiterState.slidingWindowCalls = [];
    limiterState.constructors = [];
    process.env.UPSTASH_REDIS_REST_URL = "https://redis.test";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
    if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
  });

  it.each([
    ["quoteSaveRateLimit", 10],
    ["referralRedeemRateLimit", 5],
    ["withdrawRateLimit", 3],
    ["reviewImageRateLimit", 20],
  ] as const)("%s rejects the request after %i hits in the current window", async (exportName, limit) => {
    limiterState.limit.mockImplementation(async (_identifier: string) => {
      const remaining = Math.max(0, limit - limiterState.limit.mock.calls.length);
      return {
        success: limiterState.limit.mock.calls.length <= limit,
        limit,
        remaining,
        reset: Date.now() + 60_000,
      };
    });

    const rateLimit = await import("./rate-limit");
    const limiter = rateLimit[exportName];
    expect(limiter).toBeTruthy();

    const { checkRateLimit } = rateLimit;
    const req = request("203.0.113.10");
    const statuses: number[] = [];
    for (let i = 0; i < limit + 1; i += 1) {
      const blocked = await checkRateLimit(req, limiter);
      statuses.push(blocked?.status ?? 200);
    }

    expect(statuses.slice(0, limit).every((status) => status === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    const last = await checkRateLimit(req, limiter);
    expect(last).toBeInstanceOf(NextResponse);
    expect(last?.headers.get("Retry-After")).toBeTruthy();
  });

  it.each([
    ["quoteSaveRateLimit", 10, "1 m", "ratelimit:quote-save"],
    ["referralRedeemRateLimit", 5, "1 m", "ratelimit:referral-redeem"],
    ["withdrawRateLimit", 3, "1 m", "ratelimit:withdraw"],
    ["reviewImageRateLimit", 20, "1 m", "ratelimit:review-image"],
  ] as const)(
    "%s is constructed as slidingWindow(%i, %s) with prefix %s",
    async (exportName, tokens, window, prefix) => {
      const rateLimit = await import("./rate-limit");
      expect(rateLimit[exportName]).toBeTruthy();
      expect(limiterState.constructors).toContainEqual({
        prefix,
        limiter: { tokens, window },
      });
    }
  );

  it("fails open (null 반환) when the limiter throws — rate limit 인프라 장애가 라우트 500으로 번지면 안 된다", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    limiterState.limit.mockRejectedValue(
      new Error("ERR max requests limit exceeded. Limit: 500000, Usage: 500001")
    );
    const { checkRateLimit, quoteSaveRateLimit } = await import("./rate-limit");

    const blocked = await checkRateLimit(request("203.0.113.10"), quoteSaveRateLimit, "quote-save");

    expect(blocked).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("fail"),
      expect.anything()
    );
    error.mockRestore();
  });

  it("uses a per-route identifier so shared NAT IPs are not collapsed across routes", async () => {
    limiterState.limit.mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    });
    const { checkRateLimit, quoteSaveRateLimit } = await import("./rate-limit");
    await checkRateLimit(request("203.0.113.10"), quoteSaveRateLimit, "quote-save");
    expect(limiterState.limit).toHaveBeenCalledWith("203.0.113.10:quote-save");
  });
});

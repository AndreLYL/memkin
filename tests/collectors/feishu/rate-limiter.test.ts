import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuRateLimiter } from "../../../src/collectors/feishu/rate-limiter";

describe("FeishuRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows immediate acquisition when tokens available", async () => {
    const limiter = new FeishuRateLimiter(10);
    const start = Date.now();
    await limiter.acquire();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("blocks when no tokens available", async () => {
    const limiter = new FeishuRateLimiter(2);
    await limiter.acquire();
    await limiter.acquire();
    const promise = limiter.acquire();
    vi.advanceTimersByTime(1000);
    await promise;
  });

  it("refills tokens over time", async () => {
    const limiter = new FeishuRateLimiter(5);
    for (let i = 0; i < 5; i++) {
      await limiter.acquire();
    }
    vi.advanceTimersByTime(1000);
    await limiter.acquire();
  });

  it("defaults to 50 QPS", () => {
    const limiter = new FeishuRateLimiter();
    expect(limiter.maxTokens).toBe(50);
  });
});

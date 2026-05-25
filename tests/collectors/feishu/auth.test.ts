import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeishuAuthManager } from "../../../src/collectors/feishu/auth";
import { FeishuAuthError } from "../../../src/collectors/feishu/types";

describe("FeishuAuthManager", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockTokenResponse(token: string, expire = 7200) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        msg: "ok",
        tenant_access_token: token,
        expire,
      }),
    });
  }

  it("fetches token on first getToken call", async () => {
    mockTokenResponse("t-first");
    const auth = new FeishuAuthManager("app_id", "app_secret");
    const token = await auth.getToken();
    expect(token).toBe("t-first");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns cached token on second call within TTL", async () => {
    mockTokenResponse("t-cached");
    const auth = new FeishuAuthManager("app_id", "app_secret");
    await auth.getToken();
    const token2 = await auth.getToken();
    expect(token2).toBe("t-cached");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("refreshes token when nearing expiry (5 min before)", async () => {
    vi.useFakeTimers();
    mockTokenResponse("t-old", 7200);
    const auth = new FeishuAuthManager("app_id", "app_secret");
    await auth.getToken();

    vi.advanceTimersByTime((7200 - 300 + 1) * 1000);
    mockTokenResponse("t-new", 7200);
    const token = await auth.getToken();
    expect(token).toBe("t-new");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("throws FeishuAuthError after 3 failed retries", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const auth = new FeishuAuthManager("app_id", "app_secret");
    await expect(auth.getToken()).rejects.toThrow(FeishuAuthError);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 10000);

  it("healthCheck returns ok when token can be fetched", async () => {
    mockTokenResponse("t-health");
    const auth = new FeishuAuthManager("app_id", "app_secret");
    const result = await auth.healthCheck();
    expect(result).toBe(true);
  });

  it("healthCheck returns false when token fetch fails", async () => {
    mockFetch.mockRejectedValue(new Error("fail"));
    const auth = new FeishuAuthManager("app_id", "app_secret");
    const result = await auth.healthCheck();
    expect(result).toBe(false);
  }, 10000);
});

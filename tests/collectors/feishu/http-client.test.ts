import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeishuHttpClient } from "../../../src/collectors/feishu/http-client";
import { FeishuAuthManager } from "../../../src/collectors/feishu/auth";
import { FeishuRateLimiter } from "../../../src/collectors/feishu/rate-limiter";
import { FeishuApiError } from "../../../src/collectors/feishu/types";

describe("FeishuHttpClient", () => {
  const mockFetch = vi.fn();
  let auth: FeishuAuthManager;
  let limiter: FeishuRateLimiter;
  let client: FeishuHttpClient;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    auth = { getToken: vi.fn().mockResolvedValue("t-test"), forceRefresh: vi.fn() } as any;
    limiter = { acquire: vi.fn() } as any;
    client = new FeishuHttpClient(auth, limiter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("makes authenticated GET request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ code: 0, data: { items: [] } }),
    });

    const result = await client.request("GET", "/open-apis/im/v1/messages");
    expect(mockFetch).toHaveBeenCalledWith(
      "https://open.feishu.cn/open-apis/im/v1/messages",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer t-test" }),
      }),
    );
    expect(result).toEqual({ code: 0, data: { items: [] } });
  });

  it("retries on 500 with exponential backoff", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers(), json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ code: 0, data: {} }),
      });

    const result = await client.request("GET", "/test");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ code: 0, data: {} });
  });

  it("refreshes token on 401 and retries once", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers(), json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ code: 0, data: {} }),
      });

    await client.request("GET", "/test");
    expect(auth.forceRefresh).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws FeishuApiError on 403 without retry", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 403, headers: new Headers(),
      json: async () => ({ code: 403, msg: "forbidden" }),
    });

    await expect(client.request("GET", "/test")).rejects.toThrow(FeishuApiError);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("handles 429 with rate limit reset header", async () => {
    const headers = new Headers({ "X-Ogw-RateLimit-Reset": "2" });
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 429, headers, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ code: 0, data: {} }),
      });

    await client.request("GET", "/test");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("paginates through multiple pages", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ code: 0, data: { items: [{ id: "1" }], has_more: true, page_token: "pt1" } }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, headers: new Headers(),
        json: async () => ({ code: 0, data: { items: [{ id: "2" }], has_more: false } }),
      });

    const pages: unknown[][] = [];
    for await (const page of client.paginate("/test")) {
      pages.push(page.items);
    }
    expect(pages).toEqual([[{ id: "1" }], [{ id: "2" }]]);
  });
});

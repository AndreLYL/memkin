import type { FeishuAuthManager } from "./auth.js";
import type { FeishuRateLimiter } from "./rate-limiter.js";
import { FeishuApiError } from "./types.js";

const BASE_URL = "https://open.feishu.cn";
const MAX_RETRIES = 3;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const NON_RETRYABLE_STATUS = new Set([400, 403, 404]);

export interface PagedResult<T = Record<string, unknown>> {
  items: T[];
  has_more: boolean;
  page_token?: string;
}

export interface IFeishuHttpClient {
  request<T = unknown>(
    method: string,
    path: string,
    options?: { params?: Record<string, string>; body?: unknown },
  ): Promise<T>;

  paginate<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>,
  ): AsyncGenerator<PagedResult<T>>;
}

export class FeishuHttpClient implements IFeishuHttpClient {
  constructor(
    private readonly auth: FeishuAuthManager,
    private readonly rateLimiter: FeishuRateLimiter,
  ) {}

  async request<T = unknown>(
    method: string,
    path: string,
    options?: { params?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    await this.rateLimiter.acquire();

    let url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    if (options?.params) {
      const search = new URLSearchParams(options.params);
      url += `?${search.toString()}`;
    }

    let authRefreshed = false;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const token = await this.auth.getToken();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const fetchOpts: RequestInit = { method, headers };
      if (options?.body) {
        fetchOpts.body = JSON.stringify(options.body);
      }

      let res: Response;
      try {
        res = await fetch(url, fetchOpts);
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt);
          continue;
        }
        throw new FeishuApiError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
          0,
        );
      }

      if (res.status === 401 && !authRefreshed) {
        authRefreshed = true;
        await this.auth.forceRefresh();
        continue;
      }

      if (NON_RETRYABLE_STATUS.has(res.status)) {
        let apiMsg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { msg?: string };
          if (body.msg) apiMsg = body.msg;
        } catch {}
        throw new FeishuApiError(apiMsg, res.status);
      }

      if (res.status === 429) {
        const resetSeconds = Number(res.headers.get("X-Ogw-RateLimit-Reset") || "5");
        await new Promise((r) => setTimeout(r, resetSeconds * 1000));
        continue;
      }

      if (RETRYABLE_STATUS.has(res.status)) {
        if (attempt < MAX_RETRIES) {
          await this.backoff(attempt);
          continue;
        }
        throw new FeishuApiError(`HTTP ${res.status} after ${MAX_RETRIES} retries`, res.status);
      }

      return (await res.json()) as T;
    }

    throw new FeishuApiError("Max retries exceeded", 0);
  }

  async *paginate<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>,
  ): AsyncGenerator<PagedResult<T>> {
    let pageToken: string | undefined;

    do {
      const reqParams = { ...params };
      if (pageToken) reqParams.page_token = pageToken;

      const res = await this.request<{ code: number; data: PagedResult<T> }>("GET", path, {
        params: reqParams,
      });

      const data = res.data;
      yield data;

      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = Math.min(BASE_DELAY * 2 ** attempt, MAX_DELAY);
    await new Promise((r) => setTimeout(r, delay));
  }
}

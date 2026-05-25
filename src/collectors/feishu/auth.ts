import { FeishuAuthError } from "./types";

const DEFAULT_BASE_URL = "https://open.feishu.cn";
const TOKEN_PATH = "/open-apis/auth/v3/tenant_access_token/internal";
const REFRESH_BUFFER_S = 300;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

export class FeishuAuthManager {
  private token: string | null = null;
  private expiresAt = 0;
  private readonly tokenEndpoint: string;

  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
    baseUrl?: string,
  ) {
    this.tokenEndpoint = (baseUrl ?? DEFAULT_BASE_URL) + TOKEN_PATH;
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt) {
      return this.token;
    }
    await this.refreshToken();
    return this.token ?? "";
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  async forceRefresh(): Promise<void> {
    this.token = null;
    this.expiresAt = 0;
    await this.refreshToken();
  }

  private async refreshToken(): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(this.tokenEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app_id: this.appId,
            app_secret: this.appSecret,
          }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as {
          code: number;
          msg: string;
          tenant_access_token: string;
          expire: number;
        };

        if (data.code !== 0) {
          throw new Error(`Feishu API error: ${data.code} ${data.msg}`);
        }

        this.token = data.tenant_access_token;
        this.expiresAt = Date.now() + (data.expire - REFRESH_BUFFER_S) * 1000;
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        }
      }
    }

    throw new FeishuAuthError(
      `Failed to refresh token after ${MAX_RETRIES} attempts: ${lastError?.message}`,
    );
  }
}

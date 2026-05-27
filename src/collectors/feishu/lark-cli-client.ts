import { execFile } from "node:child_process";
import type { IFeishuHttpClient, PagedResult } from "./http-client";
import { FeishuApiError } from "./types";

const DEFAULT_LARK_BIN = `${process.env.HOME}/.local/bin/lark`;
const EXEC_TIMEOUT = 30_000;

function execLark(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: EXEC_TIMEOUT, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        reject(new FeishuApiError(`lark-cli failed: ${err.message}`, 0));
        return;
      }
      resolve(stdout);
    });
  });
}

export class LarkCliHttpClient implements IFeishuHttpClient {
  private readonly bin: string;

  constructor(larkBin?: string) {
    this.bin = larkBin ?? DEFAULT_LARK_BIN;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options?: { params?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    const args = ["--as", "user", "api", method.toUpperCase(), path, "--format", "json"];

    if (options?.params && Object.keys(options.params).length > 0) {
      args.push("--params", JSON.stringify(options.params));
    }
    if (options?.body) {
      args.push("--data", JSON.stringify(options.body));
    }

    const stdout = await execLark(this.bin, args);
    const parsed = JSON.parse(stdout) as T;
    return parsed;
  }

  async *paginate<T = Record<string, unknown>>(
    path: string,
    params?: Record<string, string>,
  ): AsyncGenerator<PagedResult<T>> {
    const args = ["--as", "user", "api", "GET", path, "--page-all", "--format", "ndjson"];

    if (params && Object.keys(params).length > 0) {
      args.push("--params", JSON.stringify(params));
    }

    const stdout = await execLark(this.bin, args);
    const lines = stdout.trim().split("\n").filter(Boolean);

    const items: T[] = [];
    for (const line of lines) {
      if (line.startsWith("[")) continue;
      const parsed = JSON.parse(line) as T;
      items.push(parsed);
    }

    yield { items, has_more: false };
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      await execLark(this.bin, ["auth", "status"]);
      return { ok: true, message: "lark-cli user auth active" };
    } catch (err) {
      return {
        ok: false,
        message: `lark-cli auth check failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

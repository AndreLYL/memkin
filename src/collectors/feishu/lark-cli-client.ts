import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { IFeishuHttpClient, PagedResult } from "./http-client.js";
import { FeishuApiError } from "./types.js";

const EXEC_TIMEOUT = 120_000;
const MAX_BUFFER = 256 * 1024 * 1024;

// Locate the lark-cli executable: PATH first, then ~/.local/bin (a common
// install location that isn't always on PATH for non-interactive shells).
// Returns undefined when nothing is found; callers fall through to "lark"
// so the eventual ENOENT carries the bare binary name.
function findLarkBin(): string | undefined {
  const candidates = ["lark", "lark-cli"];
  const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
  const home = process.env.HOME;
  if (home) dirs.push(join(home, ".local", "bin"));
  for (const dir of dirs) {
    for (const name of candidates) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
  }
  return undefined;
}

function execLark(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: EXEC_TIMEOUT, maxBuffer: MAX_BUFFER }, (err, stdout) => {
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
    this.bin = larkBin ?? findLarkBin() ?? "lark";
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

  async execShortcut(domain: string, shortcut: string, flags?: string[]): Promise<string> {
    const args = ["--as", "user", domain, `+${shortcut}`, "--format", "json"];
    if (flags) args.push(...flags);
    return execLark(this.bin, args);
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

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

  /**
   * Fetch the lark-cli auth state. Returns parsed JSON output from
   * `lark auth status --verify --format json`. Throws if the subprocess
   * fails or output is unparseable.
   *
   * Used by chat-name resolution to discover the current user's open_id
   * (needed for distinguishing self from counterparty in p2p chats).
   *
   * Returned shape (subset of fields):
   *   { userOpenId: string, tokenStatus: "valid" | ..., scope: string, userName: string, ... }
   */
  async getAuthStatus<T = unknown>(): Promise<T> {
    const stdout = await execLark(this.bin, ["auth", "status", "--verify", "--format", "json"]);
    return JSON.parse(stdout) as T;
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

  /** Is the lark-cli binary present on this machine? */
  isInstalled(): boolean {
    return findLarkBin() !== undefined;
  }

  /**
   * Kick off the device-flow login (in-wizard Feishu authorization). Returns a
   * verification URL for the user to open plus a device code to poll with later.
   */
  async authStart(domains: string): Promise<{ verificationUrl: string; deviceCode: string }> {
    const stdout = await execLark(this.bin, [
      "auth",
      "login",
      "--no-wait",
      "--json",
      "--domain",
      domains,
    ]);
    const parsed = JSON.parse(stdout) as { verification_url?: string; device_code?: string };
    if (!parsed.verification_url || !parsed.device_code) {
      throw new FeishuApiError("lark-cli auth start returned no verification_url/device_code", 0);
    }
    return { verificationUrl: parsed.verification_url, deviceCode: parsed.device_code };
  }

  /** Complete the device-flow login once the user has authorized in the browser. */
  async authComplete(deviceCode: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const stdout = await execLark(this.bin, [
        "auth",
        "login",
        "--device-code",
        deviceCode,
        "--json",
      ]);
      const parsed = JSON.parse(stdout) as { event?: string };
      return { ok: parsed.event === "authorization_complete" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Compact user-identity state for the setup UI. */
  async userAuthState(): Promise<{ ready: boolean; userName?: string; openId?: string }> {
    try {
      const stdout = await execLark(this.bin, ["auth", "status", "--format", "json"]);
      const parsed = JSON.parse(stdout) as {
        identities?: { user?: { status?: string; available?: boolean } };
        // status --verify enriches the user node with these:
        userName?: string;
        userName_?: string;
      };
      const user = parsed.identities?.user;
      return {
        ready: user?.status === "ready" && user?.available === true,
      };
    } catch {
      return { ready: false };
    }
  }
}

/** Domains the Feishu collector needs — requested together so the user authorizes once. */
export const MEMKIN_LARK_DOMAINS = "im,contact,docs,drive,wiki";

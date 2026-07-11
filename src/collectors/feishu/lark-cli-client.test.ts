import { afterEach, describe, expect, it } from "vitest";
import { larkExecEnv } from "./lark-cli-client.js";

const ORIGINAL_PATH = process.env.PATH;

afterEach(() => {
  process.env.PATH = ORIGINAL_PATH;
});

describe("larkExecEnv", () => {
  it("prepends common node install dirs missing from a minimal launchd-style PATH", () => {
    process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
    const dirs = (larkExecEnv().PATH ?? "").split(":");
    // node lives in Homebrew dirs that non-interactive launchers omit
    expect(dirs).toContain("/usr/local/bin");
    expect(dirs).toContain("/opt/homebrew/bin");
    // the inherited entries are preserved
    expect(dirs).toContain("/usr/bin");
  });

  it("puts the extra dirs before the inherited PATH (so node resolves first)", () => {
    process.env.PATH = "/usr/bin";
    const dirs = (larkExecEnv().PATH ?? "").split(":");
    expect(dirs.indexOf("/usr/local/bin")).toBeLessThan(dirs.indexOf("/usr/bin"));
  });

  it("does not duplicate a dir already present on PATH", () => {
    process.env.PATH = "/usr/local/bin:/usr/bin";
    const dirs = (larkExecEnv().PATH ?? "").split(":");
    expect(dirs.filter((d) => d === "/usr/local/bin")).toHaveLength(1);
  });

  it("preserves the rest of the environment", () => {
    process.env.PATH = "/usr/bin";
    const env = larkExecEnv();
    expect(env.HOME).toBe(process.env.HOME);
  });
});

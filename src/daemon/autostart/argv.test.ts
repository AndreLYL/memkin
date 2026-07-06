import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectDaemonRuntime, resolveDaemonArgv } from "./argv.js";

const tail = ["serve", "--mcp-http", "--no-open"];

describe("resolveDaemonArgv", () => {
  it("compiled standalone → [binary, ...tail]", () => {
    expect(resolveDaemonArgv({ kind: "compiled", binaryPath: "/abs/memkin" }, tail)).toEqual([
      "/abs/memkin",
      ...tail,
    ]);
  });
  it("node-dist → [node, dist/cli.js, ...tail]", () => {
    expect(
      resolveDaemonArgv(
        { kind: "node-dist", execPath: "/abs/node", distCli: "/abs/dist/cli.js" },
        tail,
      ),
    ).toEqual(["/abs/node", "/abs/dist/cli.js", ...tail]);
  });
  it("bun-src → [bun, src/cli.ts, ...tail]", () => {
    expect(
      resolveDaemonArgv({ kind: "bun-src", bunPath: "/abs/bun", srcCli: "/abs/src/cli.ts" }, tail),
    ).toEqual(["/abs/bun", "/abs/src/cli.ts", ...tail]);
  });
  it("unknown kind → throws fail-fast", () => {
    expect(() => resolveDaemonArgv({ kind: "unknown" } as never, tail)).toThrow(
      /build or install/i,
    );
  });
});

describe("detectDaemonRuntime", () => {
  const projectRoot = "/project";

  it("compiled branch: Bun binary named memkin", () => {
    const result = detectDaemonRuntime({
      execPath: "/usr/local/bin/memkin",
      hasBun: true,
      existsSync: () => false,
      projectRoot,
    });
    expect(result).toEqual({ kind: "compiled", binaryPath: "/usr/local/bin/memkin" });
  });

  it("node-dist branch: node exec with dist/cli.js present", () => {
    const distCli = join(projectRoot, "dist", "cli.js");
    const result = detectDaemonRuntime({
      execPath: "/usr/local/bin/node",
      hasBun: false,
      existsSync: (p) => p === distCli,
      projectRoot,
    });
    expect(result).toEqual({ kind: "node-dist", execPath: "/usr/local/bin/node", distCli });
  });

  it("bun-src branch: Bun exec (not memkin) with src/cli.ts present", () => {
    const srcCli = join(projectRoot, "src", "cli.ts");
    const result = detectDaemonRuntime({
      execPath: "/usr/local/bin/bun",
      hasBun: true,
      existsSync: (p) => p === srcCli,
      projectRoot,
    });
    expect(result).toEqual({ kind: "bun-src", bunPath: "/usr/local/bin/bun", srcCli });
  });

  it("fail-fast: no Bun, no dist, no src → throws", () => {
    expect(() =>
      detectDaemonRuntime({
        execPath: "/usr/local/bin/node",
        hasBun: false,
        existsSync: () => false,
        projectRoot,
      }),
    ).toThrow(/build or install/i);
  });
});

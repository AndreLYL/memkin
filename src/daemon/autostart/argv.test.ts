import { describe, expect, it } from "vitest";
import { resolveDaemonArgv } from "./argv.js";

const tail = ["serve", "--mcp-http", "--no-open"];

describe("resolveDaemonArgv", () => {
  it("compiled standalone → [binary, ...tail]", () => {
    expect(resolveDaemonArgv({ kind: "compiled", binaryPath: "/abs/memoark" }, tail)).toEqual([
      "/abs/memoark",
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

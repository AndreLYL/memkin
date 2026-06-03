import { describe, expect, it, vi } from "vitest";
import { detectAvailableRuntimes, detectCurrentRuntime } from "../../src/setup/detect-runtime.js";

describe("detect runtime", () => {
  it("detects the current node runtime", () => {
    const runtime = detectCurrentRuntime();
    expect(runtime.name).toBe("node");
    expect(runtime.version).toBe(process.versions.node);
  });

  it("detects available POSIX runtimes with which", () => {
    const execFileSync = vi.fn((command: string, args?: string[]) => {
      if (command === "which") {
        if (args?.[0] === "tsx") throw new Error("missing");
        return `/usr/bin/${args?.[0]}`;
      }
      if (args?.[0] === "--version") {
        return command === "bun" ? "1.2.0\n" : "v22.0.0\n";
      }
      throw new Error("unexpected command");
    });

    expect(
      detectAvailableRuntimes({
        execFileSync: execFileSync as never,
        platform: "darwin",
      }),
    ).toEqual([
      { name: "bun", version: "1.2.0" },
      { name: "node", version: "v22.0.0" },
    ]);
  });

  it("uses where.exe on Windows", () => {
    const execFileSync = vi.fn((command: string, args?: string[]) => {
      if (command === "where.exe") return `C:\\Tools\\${args?.[0]}.exe`;
      if (args?.[0] === "--version") return "1.0.0";
      throw new Error("unexpected command");
    });

    const runtimes = detectAvailableRuntimes({
      execFileSync: execFileSync as never,
      platform: "win32",
    });

    expect(runtimes.map((runtime) => runtime.name)).toEqual(["bun", "node", "tsx"]);
    expect(execFileSync).toHaveBeenCalledWith("where.exe", ["bun"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
  });
});

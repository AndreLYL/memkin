import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { managedConnUrl, managedPaths, readManagedState, writeManagedState } from "./pg-paths.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mk-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("pg-paths", () => {
  it("resolves runtime/pgdata/socket under home/.memkin", () => {
    const p = managedPaths(home, "17");
    expect(p.pgdata).toBe(join(home, ".memkin", "pgdata"));
    expect(p.socketDir).toBe(join(home, ".memkin", "run"));
    expect(p.fixedPort).toBe(54329);
  });

  it("conn url carries socket host + fixed port (P0-2)", () => {
    const p = managedPaths(home, "17");
    const url = managedConnUrl(p);
    expect(url).toContain(`port=${p.fixedPort}`);
    expect(url).toContain("host=");
    expect(url).toMatch(/^postgresql:\/\/memkin@\/memkin\?/);
  });

  it("round-trips state json", () => {
    const p = managedPaths(home, "17");
    writeManagedState(p, {
      pgdata: p.pgdata,
      fixedPort: p.fixedPort,
      socketDir: p.socketDir,
      runtimeRoot: "/x",
      pgVersion: "17",
      pgCtlPath: "/x/bin/pg_ctl",
      logPath: "/l",
    });
    expect(readManagedState(p)?.fixedPort).toBe(54329);
  });

  it("honors MEMKIN_PG_RUNTIME_DIR override for runtimeRoot", () => {
    process.env.MEMKIN_PG_RUNTIME_DIR = "/custom/rt";
    try {
      expect(managedPaths(home, "17").runtimeRoot).toBe("/custom/rt");
    } finally {
      process.env.MEMKIN_PG_RUNTIME_DIR = undefined;
      delete process.env.MEMKIN_PG_RUNTIME_DIR;
    }
  });
});

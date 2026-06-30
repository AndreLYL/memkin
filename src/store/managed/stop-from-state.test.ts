import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeRunner } from "../../daemon/autostart/runner.js";
import { managedStatePath } from "./pg-paths.js";
import { stopManagedFromState } from "./stop-from-state.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mk-sfs-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("stopManagedFromState", () => {
  it("state absent → returns false, no runner call", async () => {
    const runner = makeFakeRunner([]);
    const result = await stopManagedFromState(home, runner);
    expect(result).toBe(false);
    expect(runner.calls).toHaveLength(0);
  });

  it("state present → runs pg_ctl stop -D pgdata -m fast with state's pgCtlPath + pgdata, returns true", async () => {
    // Write managed state file
    const statePath = managedStatePath(home);
    mkdirSync(join(home, ".memoark"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        pgdata: "/custom/pgdata",
        fixedPort: 54329,
        socketDir: "/custom/run",
        runtimeRoot: "/rt",
        pgVersion: "17",
        pgCtlPath: "/rt/bin/pg_ctl",
        logPath: "/custom/pgdata/postmaster.log",
      }),
      "utf8",
    );

    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    const result = await stopManagedFromState(home, runner);
    expect(result).toBe(true);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toEqual([
      "/rt/bin/pg_ctl",
      "stop",
      "-D",
      "/custom/pgdata",
      "-m",
      "fast",
    ]);
  });

  it("pg_ctl stop returns non-zero (already stopped) → still returns true, no throw", async () => {
    const statePath = managedStatePath(home);
    mkdirSync(join(home, ".memoark"), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        pgdata: "/pgdata",
        fixedPort: 54329,
        socketDir: "/run",
        runtimeRoot: "/rt",
        pgVersion: "17",
        pgCtlPath: "/rt/bin/pg_ctl",
        logPath: "/pgdata/postmaster.log",
      }),
      "utf8",
    );

    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "server is not running" }]);
    const result = await stopManagedFromState(home, runner);
    expect(result).toBe(true); // tolerate non-zero — already stopped is fine
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeRunner } from "../../daemon/autostart/runner.js";
import { managedPaths, readManagedState, writeManagedState } from "./pg-paths.js";
import type { RuntimePaths } from "./pg-runtime-provider.js";
import { createPgSupervisor } from "./pg-supervisor.js";

// Helper: set up a pgdata directory with a PG_VERSION so ensureCluster skips initdb
function seedPgdata(pgdata: string): void {
  mkdirSync(pgdata, { recursive: true });
  writeFileSync(join(pgdata, "PG_VERSION"), "17\n", "utf8");
}

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mk-"));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const fakeRuntime = (root = "/rt"): RuntimePaths => ({
  pgMajor: "17",
  root,
  bin: `${root}/bin`,
  postgres: `${root}/bin/postgres`,
  pgCtl: `${root}/bin/pg_ctl`,
  initdb: `${root}/bin/initdb`,
  createdb: `${root}/bin/createdb`,
  pgIsReady: `${root}/bin/pg_isready`,
  libDir: `${root}/lib`,
  extensionDir: `${root}/ext`,
});

describe("supervisor ensureCluster", () => {
  it("runs initdb on an empty pgdata and writes socket-only conf + temp HBA", async () => {
    const paths = managedPaths(home, "17");
    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]); // initdb ok
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.ensureCluster();

    // initdb invoked with -D pgdata, -U tester, --auth=trust
    expect(runner.calls[0]).toEqual(
      expect.arrayContaining([
        `/rt/bin/initdb`,
        "-D",
        paths.pgdata,
        "-U",
        "tester",
        "--auth=trust",
      ]),
    );

    // socket dir created 0700
    expect(existsSync(paths.socketDir)).toBe(true);

    // conf has socket-only settings
    const conf = readFileSync(join(paths.pgdata, "postgresql.conf"), "utf8");
    expect(conf).toContain("listen_addresses = ''");
    expect(conf).toContain(`unix_socket_directories = '${paths.socketDir}'`);
    expect(conf).toContain("unix_socket_permissions = 0700");
    expect(conf).toContain(`port = ${paths.fixedPort}`);

    // temp HBA allows only bootstrap user
    const hba = readFileSync(join(paths.pgdata, "pg_hba.conf"), "utf8");
    expect(hba).toContain("local all tester trust");
  });

  it("is idempotent: skips initdb when PG_VERSION already exists", async () => {
    const paths = managedPaths(home, "17");
    mkdirSync(paths.pgdata, { recursive: true });
    writeFileSync(join(paths.pgdata, "PG_VERSION"), "17\n", "utf8");

    const runner = makeFakeRunner([]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.ensureCluster();

    expect(runner.calls.length).toBe(0); // no initdb
  });

  it("throws actionable error when initdb fails", async () => {
    const paths = managedPaths(home, "17");
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "initdb: boom" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.ensureCluster()).rejects.toThrow(/initdb.*boom|boom/i);
  });

  it("re-writes conf and HBA on repeated calls (idempotent re-run)", async () => {
    const paths = managedPaths(home, "17");
    // Pre-create pgdata with PG_VERSION so initdb is skipped
    mkdirSync(paths.pgdata, { recursive: true });
    writeFileSync(join(paths.pgdata, "PG_VERSION"), "17\n", "utf8");
    // Pre-write a conf with an old managed block
    const oldConf =
      "# user setting\nmax_connections = 100\n# >>> memoark managed >>>\nold stuff\n# <<< memoark managed <<<\n";
    writeFileSync(join(paths.pgdata, "postgresql.conf"), oldConf, "utf8");

    const runner = makeFakeRunner([]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });
    await sup.ensureCluster();

    const conf = readFileSync(join(paths.pgdata, "postgresql.conf"), "utf8");
    // Old managed block replaced — new settings present
    expect(conf).toContain("listen_addresses = ''");
    expect(conf).not.toContain("old stuff");
    // Non-managed user settings preserved
    expect(conf).toContain("max_connections = 100");
  });
});

// ─── Two-phase HBA bootstrap ──────────────────────────────────────────────────

describe("supervisor start()", () => {
  it("invokes pg_ctl start with -D, -w, -o port, and -l logPath", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // pg_ctl start
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.start();

    expect(runner.calls).toHaveLength(1);
    const argv = runner.calls[0];
    expect(argv[0]).toBe("/rt/bin/pg_ctl");
    expect(argv).toContain("start");
    expect(argv).toContain("-D");
    expect(argv).toContain(paths.pgdata);
    expect(argv).toContain("-w");
    // -o carries the port
    const oIdx = argv.indexOf("-o");
    expect(oIdx).toBeGreaterThan(-1);
    expect(argv[oIdx + 1]).toContain(String(paths.fixedPort));
    // -l carries the log path (inside pgdata)
    const lIdx = argv.indexOf("-l");
    expect(lIdx).toBeGreaterThan(-1);
    expect(argv[lIdx + 1]).toContain(paths.pgdata);
  });

  it("throws an actionable error when pg_ctl start exits non-zero", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "pg_ctl: failed to start" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.start()).rejects.toThrow(/pg_ctl.*start|failed to start/i);
  });
});

describe("supervisor waitReady()", () => {
  it("polls pg_isready and resolves when it returns exit code 0", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    // First poll fails, second succeeds
    const runner = makeFakeRunner([
      { code: 1, stdout: "", stderr: "" },
      { code: 0, stdout: "", stderr: "" },
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.waitReady({ pollIntervalMs: 1, timeoutMs: 5000 });

    expect(runner.calls.length).toBeGreaterThanOrEqual(2);
    // Every call must be to pg_isready with -h socketDir and -p fixedPort
    for (const argv of runner.calls) {
      expect(argv[0]).toBe("/rt/bin/pg_isready");
      expect(argv).toContain("-h");
      expect(argv).toContain(paths.socketDir);
      expect(argv).toContain("-p");
      expect(argv).toContain(String(paths.fixedPort));
    }
  });

  it("throws on timeout when pg_isready never succeeds", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    // Always returns 1 (not ready)
    const runner = makeFakeRunner(
      Array.from({ length: 50 }, () => ({ code: 1, stdout: "", stderr: "" })),
    );
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.waitReady({ pollIntervalMs: 1, timeoutMs: 20 })).rejects.toThrow(
      /timeout|pg_isready/i,
    );
  });
});

describe("supervisor bootstrapRoles()", () => {
  it("creates role, checks db existence, creates db when absent, creates extensions", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // CREATE ROLE
      { code: 0, stdout: "", stderr: "" }, // db existence check → empty → absent
      { code: 0, stdout: "", stderr: "" }, // CREATE DATABASE
      { code: 0, stdout: "", stderr: "" }, // CREATE EXTENSION
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.bootstrapRoles();

    expect(runner.calls).toHaveLength(4);

    // Call 0: CREATE ROLE — psql against postgres db
    const roleCall = runner.calls[0];
    expect(roleCall[0]).toBe("/rt/bin/psql");
    const roleCallStr = roleCall.join(" ");
    expect(roleCallStr).toContain("CREATE ROLE memoark");
    expect(roleCall).toContain("-d");
    expect(roleCall).toContain("postgres");

    // Call 1: db existence check — -tAc with pg_database query
    const checkCall = runner.calls[1];
    expect(checkCall[0]).toBe("/rt/bin/psql");
    expect(checkCall).toContain("-tAc");
    const checkStr = checkCall.join(" ");
    expect(checkStr).toContain("pg_database");

    // Call 2: CREATE DATABASE (because check returned empty stdout)
    const createDbCall = runner.calls[2];
    expect(createDbCall[0]).toBe("/rt/bin/psql");
    expect(createDbCall.join(" ")).toContain("CREATE DATABASE memoark OWNER memoark");

    // Call 3: CREATE EXTENSION against memoark db
    const extCall = runner.calls[3];
    expect(extCall[0]).toBe("/rt/bin/psql");
    expect(extCall).toContain("-d");
    expect(extCall).toContain("memoark");
    const extStr = extCall.join(" ");
    expect(extStr).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(extStr).toContain("pg_trgm");

    // All psql calls use socket dir and fixed port
    for (const argv of runner.calls) {
      expect(argv).toContain("-h");
      expect(argv).toContain(paths.socketDir);
      expect(argv).toContain("-p");
      expect(argv).toContain(String(paths.fixedPort));
    }
  });

  it("skips CREATE DATABASE when existence check returns '1'", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // CREATE ROLE
      { code: 0, stdout: "1\n", stderr: "" }, // db existence check → db exists
      { code: 0, stdout: "", stderr: "" }, // CREATE EXTENSION
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.bootstrapRoles();

    expect(runner.calls).toHaveLength(3);
    // No CREATE DATABASE call — last call is extensions
    const extStr = runner.calls[2].join(" ");
    expect(extStr).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  it("throws an actionable error when a psql call fails", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 1, stdout: "", stderr: "psql: FATAL role creation failed" },
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.bootstrapRoles()).rejects.toThrow(/psql|role creation failed/i);
  });
});

describe("supervisor finalizeHba()", () => {
  it("writes the final restrictive pg_hba.conf and calls pg_ctl reload", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    // Write a temp HBA that must be replaced
    writeFileSync(join(paths.pgdata, "pg_hba.conf"), "local all tester trust\n", "utf8");

    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // pg_ctl reload
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.finalizeHba();

    // HBA content asserts
    const hba = readFileSync(join(paths.pgdata, "pg_hba.conf"), "utf8");
    expect(hba).toContain("local   memoark   memoark   trust");
    expect(hba).toContain("reject");
    // Must NOT contain the old bootstrap-user trust line
    expect(hba).not.toContain("local all tester trust");

    // pg_ctl reload called
    expect(runner.calls).toHaveLength(1);
    const reloadArgv = runner.calls[0];
    expect(reloadArgv[0]).toBe("/rt/bin/pg_ctl");
    expect(reloadArgv).toContain("reload");
    expect(reloadArgv).toContain("-D");
    expect(reloadArgv).toContain(paths.pgdata);
  });

  it("throws an actionable error when pg_ctl reload fails", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "pg_ctl: reload failed" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.finalizeHba()).rejects.toThrow(/reload failed|pg_ctl/i);
  });
});

// ─── Task 9: ensureUp / status / restartIfDown / stop / dispose ───────────────

/**
 * Helper: queue results for a full ensureUp first-run sequence.
 * Order: initdb, pg_ctl status (stopped=3), pg_ctl start, pg_isready,
 *        psql CREATE ROLE, psql db-check (empty), psql CREATE DATABASE,
 *        psql CREATE EXTENSION, pg_ctl reload (finalizeHba).
 */
function firstRunResults() {
  return [
    { code: 0, stdout: "", stderr: "" }, // initdb
    { code: 3, stdout: "", stderr: "" }, // pg_ctl status → stopped
    { code: 0, stdout: "", stderr: "" }, // pg_ctl start
    { code: 0, stdout: "", stderr: "" }, // pg_isready → ready
    { code: 0, stdout: "", stderr: "" }, // psql CREATE ROLE
    { code: 0, stdout: "", stderr: "" }, // psql db existence check → empty (absent)
    { code: 0, stdout: "", stderr: "" }, // psql CREATE DATABASE
    { code: 0, stdout: "", stderr: "" }, // psql CREATE EXTENSION
    { code: 0, stdout: "", stderr: "" }, // pg_ctl reload (finalizeHba)
  ];
}

describe("supervisor ensureUp() — first run (no state, empty pgdata)", () => {
  it("runs full provisioning sequence and writes state + final HBA", async () => {
    const paths = managedPaths(home, "17");
    // pgdata does NOT have PG_VERSION (empty dir)
    const runner = makeFakeRunner(firstRunResults());
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    // Simulate what real initdb would do: create PG_VERSION.
    // We intercept after the initdb call by pre-writing it; but the fake runner
    // doesn't create files. We pre-create PG_VERSION AFTER the ensureCluster
    // call would have run initdb. Because ensureUp calls ensureCluster first,
    // and ensureCluster calls mkdirSync, we can write PG_VERSION synchronously
    // before ensureUp starts by noting that: in the test, the fake runner succeeds
    // immediately, but ensureCluster checks for PG_VERSION BEFORE running initdb.
    // So: pgdata must NOT have PG_VERSION at start (initdb runs), but the file
    // must exist afterward for subsequent logic to not break.
    // The real ensureCluster does mkdirSync(paths.pgdata) after the fake initdb
    // succeeds, which creates the dir. We need PG_VERSION to exist for any code
    // that might check it. ensureCluster only checks once at entry, so we're fine.
    // BUT: start() and status() do not check PG_VERSION — only ensureCluster does.
    // So we only need pgdata dir to exist for conf/hba writes.
    // The fake runner returns code 0 for initdb; ensureCluster then calls
    // mkdirSync(paths.pgdata). After that, conf and HBA are written.
    // We do NOT need PG_VERSION to exist for the rest of ensureUp.

    await sup.ensureUp();

    // State file must exist (bootstrapped marker)
    const state = readManagedState(paths);
    expect(state).not.toBeNull();
    expect(state!.pgdata).toBe(paths.pgdata);
    expect(state!.fixedPort).toBe(paths.fixedPort);
    expect(state!.socketDir).toBe(paths.socketDir);

    // Final HBA must be in place (not the temp bootstrap HBA)
    const hba = readFileSync(join(paths.pgdata, "pg_hba.conf"), "utf8");
    expect(hba).toContain("local   memoark   memoark   trust");
    expect(hba).not.toContain("local all tester trust");

    // All 9 commands must have been called
    expect(runner.calls).toHaveLength(9);
    // First call: initdb
    expect(runner.calls[0][0]).toBe("/rt/bin/initdb");
    // Second call: pg_ctl status
    expect(runner.calls[1]).toContain("status");
    // Third call: pg_ctl start
    expect(runner.calls[2]).toContain("start");
    // Fourth call: pg_isready
    expect(runner.calls[3][0]).toBe("/rt/bin/pg_isready");
    // Last call: pg_ctl reload (finalizeHba)
    expect(runner.calls[8]).toContain("reload");
  });
});

describe("supervisor ensureUp() — warm path (already bootstrapped, running)", () => {
  it("only checks status and does NOT re-provision", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    // Write a sentinel final HBA (must NOT be overwritten)
    const sentinelHba =
      "# SENTINEL FINAL HBA — must not be overwritten\nlocal   memoark   memoark   trust\nlocal   all       all       reject\n";
    writeFileSync(join(paths.pgdata, "pg_hba.conf"), sentinelHba, "utf8");

    // Pre-write managed state (marks as bootstrapped)
    writeManagedState(paths, {
      pgdata: paths.pgdata,
      fixedPort: paths.fixedPort,
      socketDir: paths.socketDir,
      runtimeRoot: "/rt",
      pgVersion: "17",
      pgCtlPath: "/rt/bin/pg_ctl",
      logPath: join(paths.pgdata, "postmaster.log"),
    });

    // status → running (exit 0)
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // pg_ctl status → running
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.ensureUp();

    // Only one command: pg_ctl status
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toContain("status");

    // HBA must still be the sentinel (not rewritten)
    const hba = readFileSync(join(paths.pgdata, "pg_hba.conf"), "utf8");
    expect(hba).toBe(sentinelHba);
  });
});

describe("supervisor HBA security guard", () => {
  it("ensureCluster does NOT overwrite pg_hba.conf when cluster is bootstrapped", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    // Write final HBA sentinel
    const finalHba =
      "# FINAL HBA\nlocal   memoark   memoark   trust\nlocal   all       all       reject\n";
    writeFileSync(join(paths.pgdata, "pg_hba.conf"), finalHba, "utf8");

    // Write state (bootstrapped marker)
    writeManagedState(paths, {
      pgdata: paths.pgdata,
      fixedPort: paths.fixedPort,
      socketDir: paths.socketDir,
      runtimeRoot: "/rt",
      pgVersion: "17",
      pgCtlPath: "/rt/bin/pg_ctl",
      logPath: join(paths.pgdata, "postmaster.log"),
    });

    const runner = makeFakeRunner([]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.ensureCluster();

    // pg_hba.conf must still be the final HBA (not the temp one)
    const hba = readFileSync(join(paths.pgdata, "pg_hba.conf"), "utf8");
    expect(hba).toBe(finalHba);
    expect(hba).not.toContain("local all tester trust");
  });
});

describe("supervisor status()", () => {
  it("returns 'running' when pg_ctl status exits 0", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 0, stdout: "pg_ctl: server is running", stderr: "" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    const result = await sup.status();

    expect(result).toBe("running");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toContain("status");
    expect(runner.calls[0]).toContain("-D");
    expect(runner.calls[0]).toContain(paths.pgdata);
  });

  it("returns 'stopped' when pg_ctl status exits 3", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 3, stdout: "pg_ctl: no server running", stderr: "" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    const result = await sup.status();

    expect(result).toBe("stopped");
  });
});

describe("supervisor restartIfDown()", () => {
  it("returns false and does NOT start when already running", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 0, stdout: "", stderr: "" }, // status → running
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    const restarted = await sup.restartIfDown();

    expect(restarted).toBe(false);
    expect(runner.calls).toHaveLength(1); // only status check
  });

  it("returns true and starts when stopped", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([
      { code: 3, stdout: "", stderr: "" }, // status → stopped
      { code: 0, stdout: "", stderr: "" }, // pg_ctl start
      { code: 0, stdout: "", stderr: "" }, // pg_isready → ready
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    const restarted = await sup.restartIfDown({ pollIntervalMs: 1, timeoutMs: 5000 });

    expect(restarted).toBe(true);
    // status + start + waitReady
    expect(runner.calls).toHaveLength(3);
    expect(runner.calls[1]).toContain("start");
    expect(runner.calls[2][0]).toBe("/rt/bin/pg_isready");
  });

  it("clears a stale postmaster.pid and recovers (crash-recovery path)", async () => {
    // This is the critical crash-recovery scenario the recovery loop depends on.
    // After a crash: status → stopped, postmaster.pid exists with a dead pid,
    // first pg_ctl start fails (lock file exists), stale pid is removed, retry succeeds.
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    // Write a postmaster.pid with a dead pid
    const deadPid = 999999999;
    const pidFile = join(paths.pgdata, "postmaster.pid");
    writeFileSync(pidFile, `${deadPid}\n`, "utf8");

    const runner = makeFakeRunner([
      { code: 3, stdout: "", stderr: "" }, // status → stopped
      { code: 1, stdout: "", stderr: "lock file exists" }, // first pg_ctl start fails
      { code: 0, stdout: "", stderr: "" }, // retry pg_ctl start succeeds
      { code: 0, stdout: "", stderr: "" }, // pg_isready → ready
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    const restarted = await sup.restartIfDown({ pollIntervalMs: 1, timeoutMs: 5000 });

    expect(restarted).toBe(true);
    // status + 2x pg_ctl start + pg_isready
    expect(runner.calls).toHaveLength(4);
    expect(runner.calls[1]).toContain("start"); // first attempt
    expect(runner.calls[2]).toContain("start"); // retry after stale-pid removal
    expect(runner.calls[3][0]).toBe("/rt/bin/pg_isready");
    // The stale pid file must have been removed
    expect(existsSync(pidFile)).toBe(false);
  });
});

describe("supervisor startWithStaleRecovery()", () => {
  it("removes stale postmaster.pid and retries start when first start fails with dead pid", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    // Write a postmaster.pid with a dead pid (PID 1 is init on Linux; using
    // a very high fake PID that surely does not exist)
    const deadPid = 999999999;
    writeFileSync(join(paths.pgdata, "postmaster.pid"), `${deadPid}\n`, "utf8");

    const runner = makeFakeRunner([
      { code: 1, stdout: "", stderr: "lock file exists" }, // first start fails
      { code: 0, stdout: "", stderr: "" }, // retry start succeeds
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.startWithStaleRecovery();

    // Two start calls must have been made
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls[0]).toContain("start");
    expect(runner.calls[1]).toContain("start");

    // postmaster.pid must have been removed
    expect(existsSync(join(paths.pgdata, "postmaster.pid"))).toBe(false);
  });

  it("throws when start fails and no postmaster.pid exists", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    const runner = makeFakeRunner([
      { code: 1, stdout: "", stderr: "start failed: unknown reason" },
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await expect(sup.startWithStaleRecovery()).rejects.toThrow(/pg_ctl.*start|start failed/i);
  });

  it("NEVER removes postmaster.pid when the pid belongs to a live process", async () => {
    // CATASTROPHIC-CASE GUARD: removing a live postmaster's pid file would corrupt
    // the running cluster. This test proves the ESRCH-only removal guarantee.
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);

    // Write a postmaster.pid with the CURRENT process's PID (definitely alive)
    const livePid = process.pid;
    const pidFile = join(paths.pgdata, "postmaster.pid");
    writeFileSync(pidFile, `${livePid}\n`, "utf8");

    const runner = makeFakeRunner([
      { code: 1, stdout: "", stderr: "lock file exists" }, // start fails (live pid present)
    ]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    // Must throw — cannot safely start when a live process holds the pid file
    await expect(sup.startWithStaleRecovery()).rejects.toThrow();

    // CRITICAL: the pid file must still exist (was NOT deleted)
    expect(existsSync(pidFile)).toBe(true);
    // And it must still contain the original live pid
    expect(readFileSync(pidFile, "utf8").trim()).toBe(String(livePid));
  });
});

describe("supervisor stop()", () => {
  it("calls pg_ctl stop -m fast", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 0, stdout: "", stderr: "" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    await sup.stop();

    expect(runner.calls).toHaveLength(1);
    const argv = runner.calls[0];
    expect(argv[0]).toBe("/rt/bin/pg_ctl");
    expect(argv).toContain("stop");
    expect(argv).toContain("-D");
    expect(argv).toContain(paths.pgdata);
    expect(argv).toContain("-m");
    expect(argv).toContain("fast");
  });

  it("tolerates already-stopped (non-zero exit) without throwing", async () => {
    const paths = managedPaths(home, "17");
    seedPgdata(paths.pgdata);
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "pg_ctl: no server running" }]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    // Must not throw
    await expect(sup.stop()).resolves.toBeUndefined();
  });
});

describe("supervisor dispose()", () => {
  it("is a no-op and does not stop the cluster", () => {
    const paths = managedPaths(home, "17");
    // No runner queued — if dispose calls anything it would throw
    const runner = makeFakeRunner([]);
    const sup = createPgSupervisor({
      runtime: fakeRuntime(),
      paths,
      runner,
      bootstrapUser: "tester",
    });

    // Should not throw, no async, no runner calls
    expect(() => sup.dispose()).not.toThrow();
    expect(runner.calls).toHaveLength(0);
  });
});

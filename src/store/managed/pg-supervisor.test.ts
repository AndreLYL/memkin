import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeRunner } from "../../daemon/autostart/runner.js";
import { managedPaths } from "./pg-paths.js";
import { createPgSupervisor } from "./pg-supervisor.js";
import type { RuntimePaths } from "./pg-runtime-provider.js";

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

    await sup.ensureCluster();

    // initdb invoked with -D pgdata, -U tester, --auth=trust
    expect(runner.calls[0]).toEqual(
      expect.arrayContaining([`/rt/bin/initdb`, "-D", paths.pgdata, "-U", "tester", "--auth=trust"]),
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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

    await sup.ensureCluster();

    expect(runner.calls.length).toBe(0); // no initdb
  });

  it("throws actionable error when initdb fails", async () => {
    const paths = managedPaths(home, "17");
    const runner = makeFakeRunner([{ code: 1, stdout: "", stderr: "initdb: boom" }]);
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });
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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const runner = makeFakeRunner(Array.from({ length: 50 }, () => ({ code: 1, stdout: "", stderr: "" })));
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

    await expect(sup.waitReady({ pollIntervalMs: 1, timeoutMs: 20 })).rejects.toThrow(/timeout|pg_isready/i);
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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

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
    const sup = createPgSupervisor({ runtime: fakeRuntime(), paths, runner, bootstrapUser: "tester" });

    await expect(sup.finalizeHba()).rejects.toThrow(/reload failed|pg_ctl/i);
  });
});

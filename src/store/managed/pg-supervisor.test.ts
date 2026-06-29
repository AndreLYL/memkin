import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeRunner } from "../../daemon/autostart/runner.js";
import { managedPaths } from "./pg-paths.js";
import { createPgSupervisor } from "./pg-supervisor.js";
import type { RuntimePaths } from "./pg-runtime-provider.js";

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

import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { managedPaths, writeManagedState } from "../store/managed/pg-paths.js";
import { checkManagedPostgres } from "./doctor.js";

let root: string;

/** Mirror of the helper in pg-runtime-provider.test.ts */
function makeValidRuntime(base: string): string {
  const rt = join(base, "rt");
  mkdirSync(join(rt, "bin"), { recursive: true });
  mkdirSync(join(rt, "lib", "postgresql"), { recursive: true });
  mkdirSync(join(rt, "share", "postgresql", "extension"), { recursive: true });
  for (const b of ["postgres", "pg_ctl", "initdb", "createdb", "pg_isready"]) {
    const p = join(rt, "bin", b);
    writeFileSync(p, "#!/bin/sh\n", "utf8");
    chmodSync(p, 0o755);
  }
  writeFileSync(join(rt, "lib", "postgresql", "vector.dylib"), "", "utf8");
  writeFileSync(join(rt, "share", "postgresql", "extension", "pg_trgm.control"), "", "utf8");
  writeFileSync(join(rt, "share", "postgresql", "extension", "vector.control"), "", "utf8");
  return rt;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mk-doctor-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MEMOARK_PG_RUNTIME_DIR;
});

describe("checkManagedPostgres", () => {
  it("all checks OK with valid runtime, pgdata, and written state", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;

    // Write fake pgdata/PG_VERSION
    const paths = managedPaths(root, "17");
    mkdirSync(paths.pgdata, { recursive: true });
    writeFileSync(join(paths.pgdata, "PG_VERSION"), "17\n", "utf8");

    // Write managed state
    writeManagedState(paths, {
      pgdata: paths.pgdata,
      fixedPort: paths.fixedPort,
      socketDir: paths.socketDir,
      runtimeRoot: rt,
      pgVersion: "17.2",
      pgCtlPath: join(rt, "bin", "pg_ctl"),
      logPath: join(root, ".memoark", "pg.log"),
    });

    const checks = await checkManagedPostgres({ home: root });

    expect(checks).toHaveLength(3);

    const runtime = checks.find((c) => c.name === "managed-runtime");
    expect(runtime?.severity).toBe("ok");

    const cluster = checks.find((c) => c.name === "managed-cluster");
    expect(cluster?.severity).toBe("ok");

    const state = checks.find((c) => c.name === "managed-state");
    expect(state?.severity).toBe("ok");
    expect(state?.message).toContain("pgVersion=17.2");
    expect(state?.message).toContain(`port=${paths.fixedPort}`);
    expect(state?.message).toContain(`socketDir=${paths.socketDir}`);
  });

  it("runtime check FAILs with actionable message when runtime is missing", async () => {
    // No MEMOARK_PG_RUNTIME_DIR, no runtime at default location → provider throws
    const checks = await checkManagedPostgres({ home: root });

    const runtime = checks.find((c) => c.name === "managed-runtime");
    expect(runtime?.severity).toBe("fail");
    expect(runtime?.message).toMatch(/memoark up/i);
  });

  it("runtime check FAILs when a required binary is missing", async () => {
    const rt = makeValidRuntime(root);
    rmSync(join(rt, "bin", "initdb"));
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;

    const checks = await checkManagedPostgres({ home: root });

    const runtime = checks.find((c) => c.name === "managed-runtime");
    expect(runtime?.severity).toBe("fail");
    expect(runtime?.message).toMatch(/initdb/);
  });

  it("cluster check is warn and state check is warn when neither pgdata nor state exist", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;

    const checks = await checkManagedPostgres({ home: root });

    const cluster = checks.find((c) => c.name === "managed-cluster");
    expect(cluster?.severity).toBe("warn");
    expect(cluster?.message).toMatch(/memoark up/i);

    const state = checks.find((c) => c.name === "managed-state");
    expect(state?.severity).toBe("warn");
    expect(state?.message).toMatch(/memoark up/i);
  });

  it("uses injected fileExists probe — treats missing pgdata as warn", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;

    const checks = await checkManagedPostgres({
      home: root,
      fileExists: () => false, // pretend nothing exists
    });

    const cluster = checks.find((c) => c.name === "managed-cluster");
    expect(cluster?.severity).toBe("warn");
  });

  it("passes runtime_dir from managedConfig override", async () => {
    const rt = makeValidRuntime(root);
    // Do NOT set env var; pass via managedConfig instead

    const checks = await checkManagedPostgres({
      home: root,
      managedConfig: { runtime_dir: rt },
    });

    const runtime = checks.find((c) => c.name === "managed-runtime");
    expect(runtime?.severity).toBe("ok");
  });
});

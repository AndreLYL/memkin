import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgRuntimeProvider } from "./pg-runtime-provider.js";

let root: string;

function makeValidRuntime(base: string): string {
  const root = join(base, "rt");
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "lib", "postgresql"), { recursive: true });
  mkdirSync(join(root, "share", "postgresql", "extension"), { recursive: true });
  for (const b of ["postgres", "pg_ctl", "initdb", "createdb", "pg_isready"]) {
    const p = join(root, "bin", b);
    writeFileSync(p, "#!/bin/sh\n", "utf8");
    chmodSync(p, 0o755);
  }
  writeFileSync(join(root, "lib", "postgresql", "vector.dylib"), "", "utf8");
  writeFileSync(join(root, "share", "postgresql", "extension", "pg_trgm.control"), "", "utf8");
  writeFileSync(join(root, "share", "postgresql", "extension", "vector.control"), "", "utf8");
  return root;
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "mk-")); });
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.MEMOARK_PG_RUNTIME_DIR;
});

describe("PgRuntimeProvider override mode", () => {
  it("ensure() returns runtime paths from a valid override dir without download", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    const paths = await provider.ensure();
    expect(paths.root).toBe(rt);
    expect(paths.pgCtl).toBe(join(rt, "bin", "pg_ctl"));
    expect(paths.initdb).toBe(join(rt, "bin", "initdb"));
    expect(paths.pgMajor).toBe("17");
  });

  it("hard-fails when a required binary is missing", async () => {
    const rt = makeValidRuntime(root);
    rmSync(join(rt, "bin", "initdb"));
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/initdb/);
  });

  it("hard-fails when pg_trgm.control is missing", async () => {
    const rt = makeValidRuntime(root);
    rmSync(join(rt, "share", "postgresql", "extension", "pg_trgm.control"));
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/pg_trgm/);
  });

  it("download mode (no override) throws actionable not-provisioned error", async () => {
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/memoark up/);
  });
});

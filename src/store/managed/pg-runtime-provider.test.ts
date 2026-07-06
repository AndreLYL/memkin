import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgRuntimeProvider, RUNTIME_MANIFEST } from "./pg-runtime-provider.js";

let root: string;

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

/**
 * Populate a directory with a valid runtime structure (in-place, no subdirectory).
 * Used by fake `extract` implementations that write directly into destDir.
 */
function populateValidRuntime(dir: string): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  mkdirSync(join(dir, "lib", "postgresql"), { recursive: true });
  mkdirSync(join(dir, "share", "postgresql", "extension"), { recursive: true });
  for (const b of ["postgres", "pg_ctl", "initdb", "createdb", "pg_isready"]) {
    const p = join(dir, "bin", b);
    writeFileSync(p, "#!/bin/sh\n", "utf8");
    chmodSync(p, 0o755);
  }
  writeFileSync(join(dir, "lib", "postgresql", "vector.dylib"), "", "utf8");
  writeFileSync(join(dir, "share", "postgresql", "extension", "pg_trgm.control"), "", "utf8");
  writeFileSync(join(dir, "share", "postgresql", "extension", "vector.control"), "", "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mk-"));
});
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

  it("download mode (no override) throws actionable error before network when sha is placeholder", async () => {
    // Default RUNTIME_MANIFEST has TODO_PIN_* shas → placeholder guard fires first.
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/memoark up|not pinned|checksum/i);
  });
});

// ---------------------------------------------------------------------------
// Helpers for download path tests
// ---------------------------------------------------------------------------

/** Compute sha256 hex of a Buffer — matches what the provider does internally. */
function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Build a pinned manifest using the provided sha so the placeholder guard passes. */
function pinnedManifest(arm64Sha: string, x64Sha: string): typeof RUNTIME_MANIFEST {
  return {
    ...RUNTIME_MANIFEST,
    assets: {
      arm64: { file: RUNTIME_MANIFEST.assets.arm64.file, sha256: arm64Sha },
      x64: { file: RUNTIME_MANIFEST.assets.x64.file, sha256: x64Sha },
    },
  } as typeof RUNTIME_MANIFEST;
}

// ---------------------------------------------------------------------------
// Download path tests
// ---------------------------------------------------------------------------

describe("PgRuntimeProvider download path", () => {
  it("download success: fetches, verifies checksum, extracts, returns paths at runtimeRoot", async () => {
    const fakeBuf = Buffer.from("fake-tarball-arm64");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha, sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn(async (_tarPath: string, destDir: string) => {
      populateValidRuntime(destDir);
    });

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64" },
    );

    const paths = await provider.ensure();

    // Runtime landed at the expected runtimeRoot
    const expectedRoot = join(root, ".memoark", "runtime", "17");
    expect(paths.root).toBe(expectedRoot);
    expect(paths.pgMajor).toBe("17");
    expect(paths.postgres).toBe(join(expectedRoot, "bin", "postgres"));

    // fetch was called exactly once with the correct URL
    expect(fetchTarball).toHaveBeenCalledTimes(1);
    expect(fetchTarball).toHaveBeenCalledWith(`${manifest.baseUrl}/${manifest.assets.arm64.file}`);

    // extract was called once
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("checksum mismatch: throws an error matching /checksum|sha256/i", async () => {
    const fakeBuf = Buffer.from("correct-bytes");
    const wrongSha = "0".repeat(64); // definitely wrong
    const manifest = pinnedManifest(wrongSha, wrongSha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64" },
    );

    await expect(provider.ensure()).rejects.toThrow(/checksum|sha256/i);
    expect(extract).not.toHaveBeenCalled();
  });

  it("placeholder sha not pinned: throws /not pinned|checksum/i before hitting network", async () => {
    // Default RUNTIME_MANIFEST has TODO_PIN_* shas
    const fetchTarball = vi.fn();
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { fetchTarball, extract, arch: "arm64" },
    );

    await expect(provider.ensure()).rejects.toThrow(/not pinned|checksum/i);
    // Must throw BEFORE hitting the network
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("unsupported arch: throws an actionable macOS-only error pointing to PGLite", async () => {
    const fakeBuf = Buffer.from("any");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha, sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "ia32" as NodeJS.Architecture },
    );

    // Message must name the macOS-only limitation AND steer the user to the
    // default PGLite backend via the store.engine config key.
    await expect(provider.ensure()).rejects.toThrow(/macOS-only/i);
    await expect(provider.ensure()).rejects.toThrow(/PGLite/i);
    await expect(provider.ensure()).rejects.toThrow(/store\.engine/i);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("path-traversal: fake extract creates escaping symlink → ensure() throws", async () => {
    const fakeBuf = Buffer.from("traversal-test");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha, sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);

    // The target outside root — use /tmp which definitely exists
    const outside = tmpdir();

    const extract = vi.fn(async (_tarPath: string, destDir: string) => {
      // Populate valid structure first so validation could theoretically pass
      populateValidRuntime(destDir);
      // Then slip in a symlink that escapes the extraction dir
      symlinkSync(outside, join(destDir, "evil-link"));
    });

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64" },
    );

    await expect(provider.ensure()).rejects.toThrow(/path.?traversal|escap|outside/i);
  });
});

// ---------------------------------------------------------------------------
// verify() tests
// ---------------------------------------------------------------------------

describe("PgRuntimeProvider verify()", () => {
  it("verify() on a valid override dir returns paths without calling fetchTarball", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMOARK_PG_RUNTIME_DIR = rt;

    const fetchTarball = vi.fn();
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" }, { fetchTarball });

    const paths = await provider.verify();
    expect(paths.root).toBe(rt);
    expect(paths.pgMajor).toBe("17");
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("verify() throws 'not provisioned' when runtime is absent — no download attempted", async () => {
    const fetchTarball = vi.fn();
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" }, { fetchTarball });

    await expect(provider.verify()).rejects.toThrow(/not provisioned|memoark up/i);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("verify() on an already-downloaded runtimeRoot returns paths without fetch", async () => {
    // Simulate a previously downloaded runtime at the runtimeRoot location
    const runtimeRoot = join(root, ".memoark", "runtime", "17");
    populateValidRuntime(runtimeRoot);

    const fetchTarball = vi.fn();
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" }, { fetchTarball });

    const paths = await provider.verify();
    expect(paths.root).toBe(runtimeRoot);
    expect(fetchTarball).not.toHaveBeenCalled();
  });
});

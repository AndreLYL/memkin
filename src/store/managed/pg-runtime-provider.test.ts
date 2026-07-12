import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPgRuntimeProvider,
  RUNTIME_MANIFEST,
  resolveAssetKey,
} from "./pg-runtime-provider.js";

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
  delete process.env.MEMKIN_PG_RUNTIME_DIR;
});

describe("PgRuntimeProvider override mode", () => {
  it("ensure() returns runtime paths from a valid override dir without download", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMKIN_PG_RUNTIME_DIR = rt;
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
    process.env.MEMKIN_PG_RUNTIME_DIR = rt;
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/initdb/);
  });

  it("hard-fails when pg_trgm.control is missing", async () => {
    const rt = makeValidRuntime(root);
    rmSync(join(rt, "share", "postgresql", "extension", "pg_trgm.control"));
    process.env.MEMKIN_PG_RUNTIME_DIR = rt;
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" });
    await expect(provider.ensure()).rejects.toThrow(/pg_trgm/);
  });

  it("download mode (no override) throws actionable error before network when sha is placeholder", async () => {
    // Inject a placeholder-sha manifest so the guard fires regardless of the shipped (now pinned) manifest.
    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest: pinnedManifest("TODO_PIN_TEST_SHA"), arch: "arm64", platform: "darwin" },
    );
    await expect(provider.ensure()).rejects.toThrow(/memkin up|not pinned|checksum/i);
  });
});

// ---------------------------------------------------------------------------
// Helpers for download path tests
// ---------------------------------------------------------------------------

/** Compute sha256 hex of a Buffer — matches what the provider does internally. */
function sha256hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** Build a pinned manifest with the same sha for every asset so the placeholder guard passes. */
function pinnedManifest(sha: string): typeof RUNTIME_MANIFEST {
  return {
    ...RUNTIME_MANIFEST,
    assets: {
      "darwin-arm64": { file: RUNTIME_MANIFEST.assets["darwin-arm64"].file, sha256: sha },
      "darwin-x64": { file: RUNTIME_MANIFEST.assets["darwin-x64"].file, sha256: sha },
      "linux-x64": { file: RUNTIME_MANIFEST.assets["linux-x64"].file, sha256: sha },
      "linux-arm64": { file: RUNTIME_MANIFEST.assets["linux-arm64"].file, sha256: sha },
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
    const manifest = pinnedManifest(sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn(async (_tarPath: string, destDir: string) => {
      populateValidRuntime(destDir);
    });

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64", platform: "darwin" },
    );

    const paths = await provider.ensure();

    // Runtime landed at the expected runtimeRoot
    const expectedRoot = join(root, ".memkin", "runtime", "17");
    expect(paths.root).toBe(expectedRoot);
    expect(paths.pgMajor).toBe("17");
    expect(paths.postgres).toBe(join(expectedRoot, "bin", "postgres"));

    // fetch was called exactly once with the correct URL
    expect(fetchTarball).toHaveBeenCalledTimes(1);
    expect(fetchTarball).toHaveBeenCalledWith(
      `${manifest.baseUrl}/${manifest.assets["darwin-arm64"].file}`,
    );

    // extract was called once
    expect(extract).toHaveBeenCalledTimes(1);
  });

  it("download success on linux-x64: selects the linux tarball, not the darwin one", async () => {
    const fakeBuf = Buffer.from("fake-tarball-linux-x64");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn(async (_tarPath: string, destDir: string) => {
      populateValidRuntime(destDir);
    });

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "x64", platform: "linux" },
    );

    const paths = await provider.ensure();

    const expectedRoot = join(root, ".memkin", "runtime", "17");
    expect(paths.root).toBe(expectedRoot);

    expect(fetchTarball).toHaveBeenCalledTimes(1);
    expect(fetchTarball).toHaveBeenCalledWith(
      `${manifest.baseUrl}/${manifest.assets["linux-x64"].file}`,
    );
    expect(fetchTarball).not.toHaveBeenCalledWith(
      expect.stringContaining(manifest.assets["darwin-x64"].file),
    );
  });

  it("download success on linux-arm64: selects the linux-arm64 tarball", async () => {
    const fakeBuf = Buffer.from("fake-tarball-linux-arm64");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn(async (_tarPath: string, destDir: string) => {
      populateValidRuntime(destDir);
    });

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64", platform: "linux" },
    );

    await provider.ensure();

    expect(fetchTarball).toHaveBeenCalledWith(
      `${manifest.baseUrl}/${manifest.assets["linux-arm64"].file}`,
    );
  });

  it("checksum mismatch: throws an error matching /checksum|sha256/i", async () => {
    const fakeBuf = Buffer.from("correct-bytes");
    const wrongSha = "0".repeat(64); // definitely wrong
    const manifest = pinnedManifest(wrongSha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "arm64", platform: "darwin" },
    );

    await expect(provider.ensure()).rejects.toThrow(/checksum|sha256/i);
    expect(extract).not.toHaveBeenCalled();
  });

  it("placeholder sha not pinned: throws /not pinned|checksum/i before hitting network", async () => {
    // Inject a placeholder-sha manifest so the guard fires regardless of the shipped (now pinned) manifest.
    const fetchTarball = vi.fn();
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest: pinnedManifest("TODO_PIN_TEST_SHA"), fetchTarball, extract, arch: "arm64", platform: "darwin" },
    );

    await expect(provider.ensure()).rejects.toThrow(/not pinned|checksum/i);
    // Must throw BEFORE hitting the network
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("unsupported arch: throws an actionable error naming supported platforms, pointing to PGLite", async () => {
    const fakeBuf = Buffer.from("any");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha);

    const fetchTarball = vi.fn().mockResolvedValue(fakeBuf);
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { manifest, fetchTarball, extract, arch: "ia32" as NodeJS.Architecture, platform: "darwin" },
    );

    // Message must name the supported-platform limitation AND steer the user to
    // the default PGLite backend via the store.engine config key.
    await expect(provider.ensure()).rejects.toThrow(/macOS and Linux/i);
    await expect(provider.ensure()).rejects.toThrow(/PGLite/i);
    await expect(provider.ensure()).rejects.toThrow(/store\.engine/i);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("unsupported platform: e.g. win32 throws the same actionable error, even with a supported arch", async () => {
    const fetchTarball = vi.fn();
    const extract = vi.fn();

    const provider = createPgRuntimeProvider(
      { home: root, pgMajor: "17" },
      { fetchTarball, extract, arch: "x64", platform: "win32" },
    );

    await expect(provider.ensure()).rejects.toThrow(/macOS and Linux/i);
    await expect(provider.ensure()).rejects.toThrow(/PGLite/i);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("path-traversal: fake extract creates escaping symlink → ensure() throws", async () => {
    const fakeBuf = Buffer.from("traversal-test");
    const sha = sha256hex(fakeBuf);
    const manifest = pinnedManifest(sha);

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
      { manifest, fetchTarball, extract, arch: "arm64", platform: "darwin" },
    );

    await expect(provider.ensure()).rejects.toThrow(/path.?traversal|escap|outside/i);
  });
});

// ---------------------------------------------------------------------------
// resolveAssetKey() unit tests
// ---------------------------------------------------------------------------

describe("resolveAssetKey()", () => {
  it("resolves all four supported platform/arch combinations", () => {
    expect(resolveAssetKey("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolveAssetKey("darwin", "x64")).toBe("darwin-x64");
    expect(resolveAssetKey("linux", "arm64")).toBe("linux-arm64");
    expect(resolveAssetKey("linux", "x64")).toBe("linux-x64");
  });

  it("returns undefined for unsupported platforms", () => {
    expect(resolveAssetKey("win32", "x64")).toBeUndefined();
    expect(resolveAssetKey("freebsd", "x64")).toBeUndefined();
  });

  it("returns undefined for unsupported arches", () => {
    expect(resolveAssetKey("darwin", "ia32")).toBeUndefined();
    expect(resolveAssetKey("linux", "ppc64")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// verify() tests
// ---------------------------------------------------------------------------

describe("PgRuntimeProvider verify()", () => {
  it("verify() on a valid override dir returns paths without calling fetchTarball", async () => {
    const rt = makeValidRuntime(root);
    process.env.MEMKIN_PG_RUNTIME_DIR = rt;

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

    await expect(provider.verify()).rejects.toThrow(/not provisioned|memkin up/i);
    expect(fetchTarball).not.toHaveBeenCalled();
  });

  it("verify() on an already-downloaded runtimeRoot returns paths without fetch", async () => {
    // Simulate a previously downloaded runtime at the runtimeRoot location
    const runtimeRoot = join(root, ".memkin", "runtime", "17");
    populateValidRuntime(runtimeRoot);

    const fetchTarball = vi.fn();
    const provider = createPgRuntimeProvider({ home: root, pgMajor: "17" }, { fetchTarball });

    const paths = await provider.verify();
    expect(paths.root).toBe(runtimeRoot);
    expect(fetchTarball).not.toHaveBeenCalled();
  });
});

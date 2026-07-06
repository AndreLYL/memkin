import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { managedPaths } from "./pg-paths.js";

export interface RuntimePaths {
  root: string;
  pgMajor: string;
  bin: string;
  postgres: string;
  pgCtl: string;
  initdb: string;
  createdb: string;
  pgIsReady: string;
  libDir: string; // <root>/lib/postgresql
  extensionDir: string; // <root>/share/postgresql/extension
}

export interface PgRuntimeProvider {
  ensure(): Promise<RuntimePaths>;
  verify(): Promise<RuntimePaths>;
}

export interface ProviderOptions {
  home: string;
  pgMajor: string;
  runtimeDir?: string; // from store.managed.runtime_dir (overrides env if set)
}

// ---------------------------------------------------------------------------
// Pinned manifest — bump when republishing the runtime tarball
// ---------------------------------------------------------------------------

export const RUNTIME_MANIFEST = {
  version: "17.5-1", // pinned; bump when republishing runtime
  // TODO: confirm release URL once the GitHub release is published
  baseUrl: "https://github.com/AndreLYL/memkin/releases/download/pg-runtime-17.5-1",
  assets: {
    arm64: {
      file: "memkin-pg-darwin-arm64.tar.gz",
      sha256: "TODO_PIN_ARM64_SHA256", // TODO: fill in after building the release asset
    },
    x64: {
      file: "memkin-pg-darwin-x64.tar.gz",
      sha256: "TODO_PIN_X64_SHA256", // TODO: fill in after building the release asset
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Injectable download deps (for testing without network/tar)
// ---------------------------------------------------------------------------

export interface ProviderDownloadDeps {
  /** Override manifest (for tests that need a pinned sha). Defaults to RUNTIME_MANIFEST. */
  manifest?: typeof RUNTIME_MANIFEST;
  /** Fetch a tarball at the given URL and return its bytes. Defaults to a real fetch. */
  fetchTarball?: (url: string) => Promise<Buffer>;
  /** Extract a tar.gz file at tarPath into destDir. Defaults to spawning `tar -xzf`. */
  extract?: (tarPath: string, destDir: string) => Promise<void>;
  /** Process architecture — defaults to process.arch. */
  arch?: NodeJS.Architecture;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const REQUIRED_BINARIES = ["postgres", "pg_ctl", "initdb", "createdb", "pg_isready"] as const;
const VECTOR_LIBS = ["vector.dylib", "vector.so"] as const;
const REQUIRED_EXTENSIONS = ["pg_trgm.control", "vector.control"] as const;

function buildRuntimePaths(root: string, pgMajor: string): RuntimePaths {
  const bin = join(root, "bin");
  return {
    root,
    pgMajor,
    bin,
    postgres: join(bin, "postgres"),
    pgCtl: join(bin, "pg_ctl"),
    initdb: join(bin, "initdb"),
    createdb: join(bin, "createdb"),
    pgIsReady: join(bin, "pg_isready"),
    libDir: join(root, "lib", "postgresql"),
    extensionDir: join(root, "share", "postgresql", "extension"),
  };
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function validateRuntime(root: string, pgMajor: string): RuntimePaths {
  const paths = buildRuntimePaths(root, pgMajor);

  // Check each required binary exists and is executable
  for (const bin of REQUIRED_BINARIES) {
    const p = join(paths.bin, bin);
    if (!existsSync(p)) {
      throw new Error(
        `managed Postgres runtime validation failed: missing binary '${bin}' in ${paths.bin} (runtime root: ${root})`,
      );
    }
    if (!isExecutable(p)) {
      throw new Error(
        `managed Postgres runtime validation failed: '${bin}' is not executable in ${paths.bin} (runtime root: ${root})`,
      );
    }
  }

  // Check at least one of vector.dylib / vector.so exists
  const hasVectorLib = VECTOR_LIBS.some((lib) => existsSync(join(paths.libDir, lib)));
  if (!hasVectorLib) {
    throw new Error(
      `managed Postgres runtime validation failed: missing pgvector shared library (vector.dylib or vector.so) in ${paths.libDir} (runtime root: ${root})`,
    );
  }

  // Check required extension control files
  for (const ext of REQUIRED_EXTENSIONS) {
    const p = join(paths.extensionDir, ext);
    if (!existsSync(p)) {
      throw new Error(
        `managed Postgres runtime validation failed: missing extension '${ext}' in ${paths.extensionDir} (runtime root: ${root})`,
      );
    }
  }

  return paths;
}

/**
 * Recursively walk `dir` and throw if any symlink resolves outside `root`.
 * This guards against path-traversal attacks in a downloaded tarball.
 */
function assertNoPathTraversal(root: string, dir: string): void {
  const realRoot = realpathSync(root);

  function walk(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        // Resolve the symlink target to an absolute path
        let resolved: string;
        try {
          resolved = realpathSync(entryPath);
        } catch {
          // Dangling symlink — reject
          throw new Error(
            `path-traversal guard: dangling symlink at ${entryPath} in extracted runtime`,
          );
        }
        if (!resolved.startsWith(`${realRoot}/`) && resolved !== realRoot) {
          throw new Error(
            `path-traversal guard: symlink ${entryPath} points outside extraction dir (resolved to ${resolved})`,
          );
        }
        // Don't recurse into symlinks — they've been validated above
      } else if (entry.isDirectory()) {
        walk(entryPath);
      }
    }
  }

  walk(dir);
}

/**
 * Default fetchTarball: real HTTP fetch returning a Buffer.
 */
async function defaultFetchTarball(url: string): Promise<Buffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `failed to fetch runtime tarball from ${url}: ${resp.status} ${resp.statusText}`,
    );
  }
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Default extract: spawn `tar -xzf` with safe flags.
 */
async function defaultExtract(tarPath: string, destDir: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  await new Promise<void>((resolve, reject) => {
    // --no-same-owner prevents ownership attacks; -C changes into destDir
    const proc = spawn("tar", ["-xzf", tarPath, "-C", destDir, "--no-same-owner"], {
      stdio: "inherit",
    });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tar exited with code ${code}`));
    });
    proc.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPgRuntimeProvider(
  opts: ProviderOptions,
  deps: ProviderDownloadDeps = {},
): PgRuntimeProvider {
  const {
    manifest = RUNTIME_MANIFEST,
    fetchTarball = defaultFetchTarball,
    extract = defaultExtract,
    arch = process.arch as NodeJS.Architecture,
  } = deps;

  /** Resolve override dir (explicit runtimeDir > env var > already-present runtimeRoot). */
  function resolveOverrideDir(): string | undefined {
    const { home, pgMajor, runtimeDir } = opts;
    const envOverride = process.env.MEMKIN_PG_RUNTIME_DIR;
    const paths = managedPaths(home, pgMajor);

    if (runtimeDir !== undefined) return runtimeDir;
    if (envOverride !== undefined) return envOverride;
    if (existsSync(paths.runtimeRoot)) return paths.runtimeRoot;
    return undefined;
  }

  return {
    /**
     * verify() — checks an ALREADY-present runtime without downloading.
     * Used by `memkin doctor` so it never triggers a 40-80 MB download as a side effect.
     */
    async verify(): Promise<RuntimePaths> {
      const { home, pgMajor } = opts;
      const overrideDir = resolveOverrideDir();

      if (overrideDir !== undefined) {
        return validateRuntime(overrideDir, pgMajor);
      }

      const paths = managedPaths(home, pgMajor);
      throw new Error(
        `managed Postgres runtime not provisioned at ${paths.runtimeRoot} — run \`memkin up\``,
      );
    },

    /**
     * ensure() — validates existing runtime OR downloads it on first-run.
     * Used by `memkin up`.
     */
    async ensure(): Promise<RuntimePaths> {
      const { home, pgMajor } = opts;
      const overrideDir = resolveOverrideDir();

      if (overrideDir !== undefined) {
        return validateRuntime(overrideDir, pgMajor);
      }

      // -----------------------------------------------------------------------
      // Download path — no runtime present yet
      // -----------------------------------------------------------------------

      // 1. Pick asset by arch
      let assetKey: "arm64" | "x64";
      if (arch === "arm64") {
        assetKey = "arm64";
      } else if (arch === "x64") {
        assetKey = "x64";
      } else {
        throw new Error(
          `The self-managed Postgres engine is currently macOS-only (arm64/x64); your platform (${process.platform}/${arch}) is not supported yet. ` +
            `Use the default PGLite backend instead — it works everywhere. ` +
            `Set \`store.engine: pglite\` in memkin.yaml (or remove \`store.engine\` to use the default).`,
        );
      }

      const asset = manifest.assets[assetKey];

      // 2. Guard against unpinned manifest shas before hitting the network
      if (asset.sha256.startsWith("TODO_PIN_")) {
        throw new Error(
          `managed Postgres runtime checksum not pinned — build/publish the runtime first (manifest.assets.${assetKey}.sha256 is still a placeholder)`,
        );
      }

      // 3. Fetch
      const url = `${manifest.baseUrl}/${asset.file}`;
      const buf = await fetchTarball(url);

      // 4. Verify sha256
      const actual = createHash("sha256").update(buf).digest("hex");
      if (actual !== asset.sha256) {
        throw new Error(
          `managed Postgres runtime checksum mismatch for ${asset.file}:\n  expected: ${asset.sha256}\n  actual:   ${actual}\n(re-run with a fresh download or update the manifest)`,
        );
      }

      // 5. Write buf to a temp file under the same filesystem (.memkin/tmp) to
      //    keep the later atomic rename cross-device-safe.
      const managedBase = managedPaths(home, pgMajor).base;
      mkdirSync(managedBase, { recursive: true });

      const tmpBase = join(managedBase, "tmp");
      mkdirSync(tmpBase, { recursive: true });

      const tarPath = join(tmpBase, asset.file);
      writeFileSync(tarPath, buf);

      // 6. mkdtemp extract dir under the same base
      const tmpExtract = mkdtempSync(join(tmpBase, "extract-"));

      try {
        await extract(tarPath, tmpExtract);

        // 7. Path-traversal / symlink guard
        assertNoPathTraversal(tmpExtract, tmpExtract);

        // 8. Validate the extracted structure
        validateRuntime(tmpExtract, pgMajor);

        // 9. Atomic move into place
        const { runtimeRoot } = managedPaths(home, pgMajor);
        mkdirSync(join(runtimeRoot, ".."), { recursive: true });
        renameSync(tmpExtract, runtimeRoot);

        // 10. Write manifest record
        writeFileSync(
          join(runtimeRoot, "manifest.json"),
          JSON.stringify(
            { version: manifest.version, sha256: asset.sha256, arch: assetKey },
            null,
            2,
          ),
          "utf8",
        );

        return validateRuntime(runtimeRoot, pgMajor);
      } finally {
        // Clean up tmp tarball (the extract dir is either moved or already gone)
        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(tarPath);
        } catch {
          // best-effort
        }
      }
    },
  };
}

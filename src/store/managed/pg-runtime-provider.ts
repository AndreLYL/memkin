import { accessSync, constants } from "node:fs";
import { existsSync } from "node:fs";
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
  libDir: string;        // <root>/lib/postgresql
  extensionDir: string;  // <root>/share/postgresql/extension
}

export interface PgRuntimeProvider {
  ensure(): Promise<RuntimePaths>;
}

export interface ProviderOptions {
  home: string;
  pgMajor: string;
  runtimeDir?: string; // from store.managed.runtime_dir (overrides env if set)
}

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
        `managed Postgres runtime validation failed: missing binary '${bin}' in ${paths.bin} (runtime root: ${root})`
      );
    }
    if (!isExecutable(p)) {
      throw new Error(
        `managed Postgres runtime validation failed: '${bin}' is not executable in ${paths.bin} (runtime root: ${root})`
      );
    }
  }

  // Check at least one of vector.dylib / vector.so exists
  const hasVectorLib = VECTOR_LIBS.some((lib) => existsSync(join(paths.libDir, lib)));
  if (!hasVectorLib) {
    throw new Error(
      `managed Postgres runtime validation failed: missing pgvector shared library (vector.dylib or vector.so) in ${paths.libDir} (runtime root: ${root})`
    );
  }

  // Check required extension control files
  for (const ext of REQUIRED_EXTENSIONS) {
    const p = join(paths.extensionDir, ext);
    if (!existsSync(p)) {
      throw new Error(
        `managed Postgres runtime validation failed: missing extension '${ext}' in ${paths.extensionDir} (runtime root: ${root})`
      );
    }
  }

  return paths;
}

export function createPgRuntimeProvider(opts: ProviderOptions): PgRuntimeProvider {
  return {
    async ensure(): Promise<RuntimePaths> {
      const { home, pgMajor, runtimeDir } = opts;

      // Resolve override dir: explicit option > env var > existing default runtime root
      const envOverride = process.env.MEMOARK_PG_RUNTIME_DIR;
      const paths = managedPaths(home, pgMajor);

      let overrideDir: string | undefined;
      if (runtimeDir !== undefined) {
        overrideDir = runtimeDir;
      } else if (envOverride !== undefined) {
        overrideDir = envOverride;
      } else if (existsSync(paths.runtimeRoot)) {
        overrideDir = paths.runtimeRoot;
      }

      if (overrideDir !== undefined) {
        return validateRuntime(overrideDir, pgMajor);
      }

      // No override and no existing runtime dir → download stub
      throw new Error(
        `managed Postgres runtime not provisioned at ${paths.runtimeRoot} — run \`memoark up\` (automatic download not yet implemented)`
      );
    },
  };
}

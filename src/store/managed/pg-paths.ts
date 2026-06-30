import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MANAGED_FIXED_PORT = 54329;

export interface ManagedPaths {
  base: string;
  runtimeRoot: string;
  pgdata: string;
  socketDir: string;
  fixedPort: number;
  statePath: string;
}

export interface ManagedState {
  pgdata: string;
  fixedPort: number;
  socketDir: string;
  runtimeRoot: string;
  pgVersion: string;
  pgCtlPath: string;
  logPath: string;
}

export function managedPaths(home: string, pgMajor: string): ManagedPaths {
  const base = join(home, ".memoark");
  return {
    base,
    runtimeRoot: process.env.MEMOARK_PG_RUNTIME_DIR ?? join(base, "runtime", pgMajor),
    pgdata: join(base, "pgdata"),
    socketDir: join(base, "run"),
    fixedPort: MANAGED_FIXED_PORT,
    statePath: join(base, "managed-pg.json"),
  };
}

/**
 * Returns the path to managed-pg.json without requiring a pgMajor version.
 * The state file path is version-independent (~/.memoark/managed-pg.json).
 */
export function managedStatePath(home: string): string {
  return join(home, ".memoark", "managed-pg.json");
}

// socketDir as host; node-postgres needs the port to find .s.PGSQL.<port> (P0-2)
export function managedConnUrl(p: ManagedPaths): string {
  const host = encodeURIComponent(p.socketDir);
  return `postgresql://memoark@/memoark?host=${host}&port=${p.fixedPort}`;
}

export function writeManagedState(p: ManagedPaths, s: ManagedState): void {
  mkdirSync(p.base, { recursive: true });
  writeFileSync(p.statePath, JSON.stringify(s, null, 2), "utf8");
}

export function readManagedState(p: ManagedPaths): ManagedState | null {
  if (!existsSync(p.statePath)) return null;
  try {
    return JSON.parse(readFileSync(p.statePath, "utf8")) as ManagedState;
  } catch {
    return null;
  }
}

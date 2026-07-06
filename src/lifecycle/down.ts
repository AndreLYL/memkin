import type { DisableAutostartResult } from "../daemon/autostart/index.js";

export interface DownDeps {
  home: string;
  platform: NodeJS.Platform;
  acquireLock: (home: string, command: string) => { release: () => void };
  disable: () => Promise<DisableAutostartResult>;
  /** The storage engine — "managed" triggers managed-PG teardown. */
  engine?: string;
  /** Called to stop managed Postgres when engine === "managed" and teardown is safe. */
  stopManagedPg?: () => Promise<void>;
}

export interface DownResult {
  stopped: boolean;
  note: string;
}

export async function down(deps: DownDeps): Promise<DownResult> {
  const lock = deps.acquireLock(deps.home, "down");
  try {
    const result = await deps.disable();

    if (result.outcome === "bootoutFailed") {
      return {
        stopped: false,
        note: "Daemon may still be running — managed Postgres left running and daemon state preserved. Investigate, then retry `memkin down`.",
      };
    }

    // outcome is "notLoaded" or "success" — safe to stop managed PG
    if (deps.engine === "managed" && deps.stopManagedPg) {
      await deps.stopManagedPg();
    }

    return {
      stopped: true,
      note: "Daemon stopped and autostart removed. Agent config left intact — run `memkin uninstall` to revert agents.",
    };
  } finally {
    lock.release();
  }
}

export interface DownDeps {
  home: string;
  platform: NodeJS.Platform;
  acquireLock: (home: string, command: string) => { release: () => void };
  disable: () => Promise<void>;
}

export interface DownResult {
  stopped: boolean;
  note: string;
}

export async function down(deps: DownDeps): Promise<DownResult> {
  const lock = deps.acquireLock(deps.home, "down");
  try {
    await deps.disable();
    return {
      stopped: true,
      note: "Daemon stopped and autostart removed. Agent config left intact — run `memoark uninstall` to revert agents.",
    };
  } finally {
    lock.release();
  }
}

import { existsSync, readFileSync } from "node:fs";
import type { CommandRunner } from "../../daemon/autostart/runner.js";
import type { ManagedState } from "./pg-paths.js";
import { managedStatePath } from "./pg-paths.js";

/**
 * Read the managed-pg.json state and stop the Postgres cluster using the
 * pg_ctl path recorded in the state.
 *
 * - If no state file exists → returns false (nothing to stop).
 * - If state exists → runs pg_ctl stop -m fast; tolerates non-zero exit
 *   (already stopped) → returns true.
 */
export async function stopManagedFromState(home: string, runner: CommandRunner): Promise<boolean> {
  const statePath = managedStatePath(home);
  if (!existsSync(statePath)) return false;

  let state: ManagedState;
  try {
    state = JSON.parse(readFileSync(statePath, "utf8")) as ManagedState;
  } catch {
    return false;
  }

  // Tolerate non-zero (already stopped is fine)
  await runner.run([state.pgCtlPath, "stop", "-D", state.pgdata, "-m", "fast"]);
  return true;
}

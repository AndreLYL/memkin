import { homedir } from "node:os";
import type { Config } from "../../core/config.js";
import { withManagedLock } from "./managed-lock.js";
import { managedConnUrl, managedPaths } from "./pg-paths.js";
import type { PgRuntimeProvider, RuntimePaths } from "./pg-runtime-provider.js";

export interface ManagedSupervisor {
  ensureUp(): Promise<void>;
  // more methods (status/stop/dispose/restartIfDown) land in Phase 2; keep this minimal interface here
}

export interface ProvisionDeps {
  home?: string;
  provider: PgRuntimeProvider;
  makeSupervisor: (rt: RuntimePaths, home: string) => ManagedSupervisor;
}

export interface ProvisionResult {
  supervisor: ManagedSupervisor;
  pgConfig: Config;
}

export async function provisionManaged(config: Config, deps: ProvisionDeps): Promise<ProvisionResult> {
  const home = deps.home ?? homedir();
  return withManagedLock(home, async () => {
    const rt = await deps.provider.ensure();
    const supervisor = deps.makeSupervisor(rt, home);
    await supervisor.ensureUp();
    const paths = managedPaths(home, rt.pgMajor);
    const pgConfig: Config = {
      ...config,
      store: {
        ...(config.store ?? {}),
        engine: "postgres" as const,
        database_url: managedConnUrl(paths),
        pool_size: config.store?.pool_size,
        data_dir: undefined,
      },
    };
    return { supervisor, pgConfig };
  });
}

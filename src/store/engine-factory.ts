import type { Config } from "../core/config.js";
import type { SqlExecutor } from "./sql-executor.js";

export async function createEngine(config: Config): Promise<SqlExecutor> {
  const engine = config.store?.engine ?? "pglite";

  switch (engine) {
    case "pglite": {
      const { PgliteExecutor } = await import("./pglite-executor.js");
      return PgliteExecutor.create(config.store?.data_dir, {});
    }
    case "postgres": {
      const { PostgresExecutor } = await import("./postgres-executor.js");
      return PostgresExecutor.create(config);
    }
    default:
      throw new Error(`Unknown store engine: "${engine}". Supported: pglite, postgres.`);
  }
}

import type { Config } from "../core/config.js";
import type { SqlExecutor } from "./sql-executor.js";

export async function createEngine(config: Config): Promise<SqlExecutor> {
  const engine = config.store?.engine ?? "pglite";

  switch (engine) {
    case "pglite": {
      const { PgliteExecutor } = await import("./pglite-executor.js");
      // In a `bun --compile` sidecar (Tauri desktop) the PGLite WASM/data assets are
      // staged outside the executable and their real path arrives via --pglite-assets
      // (mirrored to MEMKIN_PGLITE_ASSETS by the serve command). Thread it through so
      // the compiled binary loads assets from the resource dir instead of the missing
      // <execDir>/assets fallback. In dev/non-compiled mode this override is ignored.
      return PgliteExecutor.create(config.store?.data_dir, {
        assetsOverride: process.env.MEMKIN_PGLITE_ASSETS,
      });
    }
    case "postgres": {
      const { PostgresExecutor } = await import("./postgres-executor.js");
      return PostgresExecutor.create(config);
    }
    case "managed":
      throw new Error(
        'engine "managed" must be resolved via resolveDb/provisionManaged before reaching the engine factory',
      );
    default:
      throw new Error(`Unknown store engine: "${engine}". Supported: pglite, postgres, managed.`);
  }
}

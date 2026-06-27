import type { Config } from "../core/config.js";
import { SCHEMA_SQL } from "../embedded-assets.generated.js";
import { createEngine } from "./engine-factory.js";
import { runMigrations } from "./migrations/index.js";
import type { SqlConn, SqlExecutor } from "./sql-executor.js";

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Resolve the embedded base `schema.sql` template's `__EMBEDDING_DIM__` placeholder
 * (the `vector(__EMBEDDING_DIM__)` column typemod) to a concrete dimension count.
 *
 * Use this anywhere a raw PGlite instance is bootstrapped from schema.sql — executing
 * the template verbatim makes Postgres parse the placeholder as an integer and fail with
 * `invalid input syntax for type integer: "__embedding_dim__"`.
 */
export function loadSchemaSql(dims: number = DEFAULT_EMBEDDING_DIMENSIONS): string {
  return SCHEMA_SQL.replace("__EMBEDDING_DIM__", String(dims));
}

export interface DatabaseOptions {
  embeddingDimensions?: number;
  lockLabel?: string;
}

export class Database {
  private constructor(
    readonly executor: SqlExecutor,
    readonly embeddingDimensions: number,
  ) {}

  static async create(
    dataDirOrConfig?: string | Config,
    opts?: DatabaseOptions,
  ): Promise<Database> {
    const config: Config =
      typeof dataDirOrConfig === "string" || dataDirOrConfig === undefined
        ? ({ store: { engine: "pglite", data_dir: dataDirOrConfig } } as Config)
        : dataDirOrConfig;

    const dims = opts?.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;

    let executor: SqlExecutor | undefined;
    try {
      executor = await createEngine(config);
      const e = executor;
      await e.bootstrap(async (conn: SqlConn) => {
        await conn.exec(loadSchemaSql(dims));
        await runMigrations(conn);
        await ensureEmbeddingConsistency(conn, dims);
      });
      return new Database(e, dims);
    } catch (err) {
      await executor?.close().catch(() => {});
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.executor.close();
  }
}

async function ensureEmbeddingConsistency(conn: SqlConn, targetDims: number): Promise<void> {
  const result = await conn.query<{ atttypmod: number }>(
    `SELECT atttypmod FROM pg_attribute
     WHERE attrelid = 'content_chunks'::regclass
       AND attname = 'embedding'`,
  );
  if (result.rows.length === 0) return;

  // pgvector stores dimensions as atttypmod (the raw value equals the dimension count)
  const currentDims = result.rows[0].atttypmod;
  if (currentDims === targetDims) return;

  console.log(
    `[memoark] Embedding dimensions changed: ${currentDims} → ${targetDims}. ` +
      "Clearing existing embeddings for re-indexing.",
  );

  await conn.exec(`
    DROP INDEX IF EXISTS idx_chunks_embedding;
    ALTER TABLE content_chunks ALTER COLUMN embedding TYPE vector(${targetDims});
    UPDATE content_chunks SET embedding = NULL, embedded_at = NULL;
    CREATE INDEX idx_chunks_embedding ON content_chunks
      USING hnsw (embedding vector_cosine_ops);
  `);
}

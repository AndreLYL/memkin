import type { Config } from "../core/config.js";
import { SCHEMA_SQL } from "../embedded-assets.generated.js";
import { createEngine } from "./engine-factory.js";
import { runMigrations } from "./migrations/index.js";
import type { SqlConn, SqlExecutor } from "./sql-executor.js";
import { fingerprintString, readMeta, writeMeta } from "./store-meta.js";

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
        await ensureEmbeddingConsistency(conn, dims, config);
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

/**
 * Migrate the embedding column dimensions if they changed.
 * Clears all existing embeddings when the dimension count changes so they
 * will be re-indexed with the new model.
 */
async function migrateEmbeddingDimensions(conn: SqlConn, targetDims: number): Promise<void> {
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
    `[memkin] Embedding dimensions changed: ${currentDims} → ${targetDims}. ` +
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

async function ensureEmbeddingConsistency(
  conn: SqlConn,
  targetDims: number,
  config: Config,
): Promise<void> {
  const fp = {
    provider: config.embedding?.provider ?? "openai",
    model: config.embedding?.model ?? "text-embedding-3-large",
    dimensions: targetDims,
  };
  const want = fingerprintString(fp);
  const have = await readMeta(conn, "embedding_fingerprint");

  if (have === null) {
    // Fresh database — migrate dimensions if needed, then record fingerprint.
    await migrateEmbeddingDimensions(conn, targetDims);
    await writeMeta(conn, "embedding_fingerprint", want);
    return;
  }

  if (have !== want) {
    throw new Error(
      `Embedding fingerprint mismatch: db="${have}" config="${want}". ` +
        "不静默改写共享库。改回原 embedding 配置或跑显式 reindex。",
    );
  }

  // Fingerprint matches — still run dimension migration guard (idempotent).
  await migrateEmbeddingDimensions(conn, targetDims);
}

/**
 * Exported for unit-testing the fingerprint logic without requiring a
 * disk-backed PGLite instance (which would OOM in vitest fork workers).
 *
 * @internal — test use only.
 */
export async function ensureEmbeddingConsistencyForTest(
  conn: SqlConn,
  targetDims: number,
  config: Config,
): Promise<void> {
  return ensureEmbeddingConsistency(conn, targetDims, config);
}

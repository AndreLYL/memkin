import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { runMigrations } from "./migrations/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

/**
 * Read the base `schema.sql` template and resolve the `__EMBEDDING_DIM__` placeholder
 * (the `vector(__EMBEDDING_DIM__)` column typemod) to a concrete dimension count.
 *
 * Use this anywhere a raw PGlite instance is bootstrapped from schema.sql — executing
 * the template verbatim makes Postgres parse the placeholder as an integer and fail with
 * `invalid input syntax for type integer: "__embedding_dim__"`.
 */
export function loadSchemaSql(dims: number = DEFAULT_EMBEDDING_DIMENSIONS): string {
  const template = readFileSync(join(__dirname, "schema.sql"), "utf-8");
  return template.replace("__EMBEDDING_DIM__", String(dims));
}

export interface DatabaseOptions {
  embeddingDimensions?: number;
}

export class Database {
  private constructor(
    private _pg: PGlite,
    readonly embeddingDimensions: number,
  ) {}

  get pg(): PGlite {
    return this._pg;
  }

  static async create(dataDir?: string, opts?: DatabaseOptions): Promise<Database> {
    const dims = opts?.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;

    const pg = new PGlite({
      dataDir,
      extensions: { vector },
    });

    await pg.exec(loadSchemaSql(dims));
    await runMigrations(pg);

    await Database.migrateEmbeddingDimensions(pg, dims);

    return new Database(pg, dims);
  }

  private static async migrateEmbeddingDimensions(pg: PGlite, targetDims: number): Promise<void> {
    const result = await pg.query<{ atttypmod: number }>(
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

    await pg.exec(`
      DROP INDEX IF EXISTS idx_chunks_embedding;
      ALTER TABLE content_chunks ALTER COLUMN embedding TYPE vector(${targetDims});
      UPDATE content_chunks SET embedding = NULL, embedded_at = NULL;
      CREATE INDEX idx_chunks_embedding ON content_chunks
        USING hnsw (embedding vector_cosine_ops);
    `);
  }

  async close(): Promise<void> {
    await this._pg.close();
  }
}

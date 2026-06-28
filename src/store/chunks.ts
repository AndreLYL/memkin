import type { SqlConn } from "./sql-executor.js";

export interface Chunk {
  id: number;
  page_id: number;
  chunk_index: number;
  chunk_text: string;
  chunk_source: string;
  token_count: number | null;
  embedded_at: string | null;
  model: string;
}

const CHUNK_SIZE = 300;
const CHUNK_OVERLAP = 50;

function splitIntoChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= CHUNK_SIZE) {
    return [words.join(" ")];
  }
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end >= words.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Rechunk a page's content within an existing SQL connection (or transaction).
 * Exported so that putPageWithChunks can call it inside a transaction without
 * needing a separate ChunkStore instance.
 */
export async function rechunkTx(conn: SqlConn, pageId: number, content: string): Promise<void> {
  const textChunks = splitIntoChunks(content);

  const placeholders: string[] = [];
  const params: (number | string)[] = [];
  for (let i = 0; i < textChunks.length; i++) {
    const base = i * 4;
    placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, 'compiled_truth', $${base + 4})`);
    params.push(pageId, i, textChunks[i], textChunks[i].split(/\s+/).length);
  }

  await conn.query(
    `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
     VALUES ${placeholders.join(", ")}
     ON CONFLICT (page_id, chunk_index) DO UPDATE SET
       chunk_text = EXCLUDED.chunk_text,
       chunk_source = EXCLUDED.chunk_source,
       token_count = EXCLUDED.token_count,
       embedding = CASE
         WHEN EXCLUDED.chunk_text != content_chunks.chunk_text THEN NULL
         ELSE content_chunks.embedding
       END,
       embedded_at = CASE
         WHEN EXCLUDED.chunk_text != content_chunks.chunk_text THEN NULL
         ELSE content_chunks.embedded_at
       END`,
    params,
  );

  await conn.query("DELETE FROM content_chunks WHERE page_id = $1 AND chunk_index >= $2", [
    pageId,
    textChunks.length,
  ]);
}

export class ChunkStore {
  constructor(private pg: SqlConn) {}

  async rechunk(pageId: number, content: string): Promise<void> {
    await rechunkTx(this.pg, pageId, content);
  }

  async getChunks(pageSlug: string): Promise<Chunk[]> {
    const result = await this.pg.query<Chunk>(
      `SELECT cc.* FROM content_chunks cc
       JOIN pages p ON p.id = cc.page_id
       WHERE p.slug = $1
       ORDER BY cc.chunk_index`,
      [pageSlug],
    );
    return result.rows;
  }

  async getStaleChunks(limit?: number): Promise<Chunk[]> {
    let sql = "SELECT * FROM content_chunks WHERE embedded_at IS NULL ORDER BY id";
    const params: unknown[] = [];
    if (limit) {
      sql += " LIMIT $1";
      params.push(limit);
    }
    const result = await this.pg.query<Chunk>(sql, params);
    return result.rows;
  }
}

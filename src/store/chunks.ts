import type { PGlite } from "@electric-sql/pglite";

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

export class ChunkStore {
  constructor(private pg: PGlite) {}

  async rechunk(pageId: number, content: string): Promise<void> {
    const textChunks = splitIntoChunks(content);
    for (let i = 0; i < textChunks.length; i++) {
      const wordCount = textChunks[i].split(/\s+/).length;
      await this.pg.query(
        `INSERT INTO content_chunks (page_id, chunk_index, chunk_text, chunk_source, token_count)
         VALUES ($1, $2, $3, 'compiled_truth', $4)
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
        [pageId, i, textChunks[i], wordCount]
      );
    }
    await this.pg.query(
      "DELETE FROM content_chunks WHERE page_id = $1 AND chunk_index >= $2",
      [pageId, textChunks.length]
    );
  }

  async getChunks(pageSlug: string): Promise<Chunk[]> {
    const result = await this.pg.query(
      `SELECT cc.* FROM content_chunks cc
       JOIN pages p ON p.id = cc.page_id
       WHERE p.slug = $1
       ORDER BY cc.chunk_index`,
      [pageSlug]
    );
    return result.rows as Chunk[];
  }

  async getStaleChunks(limit?: number): Promise<Chunk[]> {
    let sql = "SELECT * FROM content_chunks WHERE embedded_at IS NULL ORDER BY id";
    const params: unknown[] = [];
    if (limit) {
      sql += " LIMIT $1";
      params.push(limit);
    }
    const result = await this.pg.query(sql, params);
    return result.rows as Chunk[];
  }
}

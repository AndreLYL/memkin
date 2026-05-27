import type { PGlite } from "@electric-sql/pglite";
import OpenAI from "openai";

export interface EmbeddingConfig {
  provider: "openai" | "ollama";
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
}

const BATCH_SIZE = 100;

export class EmbeddingService {
  private client: OpenAI;
  private model: string;
  private dimensions: number;

  constructor(
    private pg: PGlite,
    config: EmbeddingConfig,
  ) {
    this.model = config.model ?? "text-embedding-3-large";
    this.dimensions = config.dimensions ?? 768;
    this.client = new OpenAI({
      apiKey: config.apiKey ?? "",
      baseURL:
        config.provider === "ollama"
          ? (config.baseUrl ?? "http://localhost:11434/v1")
          : config.baseUrl,
    });
  }

  async embedStale(opts?: { limit?: number }): Promise<{ embedded: number; errors: number }> {
    const limit = opts?.limit;
    let sql = "SELECT id, chunk_text FROM content_chunks WHERE embedded_at IS NULL ORDER BY id";
    const params: unknown[] = [];
    if (limit) {
      sql += " LIMIT $1";
      params.push(limit);
    }
    const stale = await this.pg.query(sql, params);
    if (stale.rows.length === 0) return { embedded: 0, errors: 0 };

    let embedded = 0;
    let errors = 0;

    for (let i = 0; i < stale.rows.length; i += BATCH_SIZE) {
      const batch = stale.rows.slice(i, i + BATCH_SIZE) as Array<{
        id: number;
        chunk_text: string;
      }>;
      const texts = batch.map((r) => r.chunk_text);
      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: texts,
          dimensions: this.dimensions,
        });
        for (let j = 0; j < batch.length; j++) {
          const vec = response.data[j].embedding;
          const vecStr = `[${vec.join(",")}]`;
          await this.pg.query(
            `UPDATE content_chunks SET embedding = $1::vector, embedded_at = NOW() WHERE id = $2`,
            [vecStr, batch[j].id],
          );
          embedded++;
        }
      } catch (err) {
        console.error(
          `embedding: batch ${i}-${i + batch.length} failed:`,
          err instanceof Error ? err.message : err,
        );
        errors += batch.length;
      }
    }
    return { embedded, errors };
  }

  async embedText(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });
    return response.data[0].embedding;
  }
}

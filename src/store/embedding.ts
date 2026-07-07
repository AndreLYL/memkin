import OpenAI from "openai";
import type { SqlConn } from "./sql-executor.js";

export interface EmbeddingConfig {
  provider: "openai" | "ollama";
  model?: string;
  dimensions?: number;
  apiKey?: string;
  baseUrl?: string;
}

export interface EmbeddingServiceDeps {
  /**
   * Guard invoked before every real embedding operation, ahead of any client
   * construction or database access. Used to defer embedding-fingerprint
   * validation (Database.assertEmbeddingConsistent) to first actual use, so
   * read-only commands (search FTS, export) can open a mismatched database
   * without being blocked and without embedding credentials.
   */
  beforeFirstUse?: () => void;
}

const BATCH_SIZE = 100;

export class EmbeddingService {
  /**
   * Lazily constructed on first use — building the OpenAI client eagerly
   * would demand credentials even on code paths that never embed anything.
   */
  private client?: OpenAI;
  private clientOptions: { apiKey: string; baseURL?: string };
  private model: string;
  private dimensions: number;

  constructor(
    private pg: SqlConn,
    config: EmbeddingConfig,
    private deps: EmbeddingServiceDeps = {},
  ) {
    this.model = config.model ?? "text-embedding-3-large";
    this.dimensions = config.dimensions ?? 1536;
    const isOllama = config.provider === "ollama";
    this.clientOptions = {
      apiKey: isOllama ? (config.apiKey ?? "ollama") : (config.apiKey ?? ""),
      baseURL: isOllama ? (config.baseUrl ?? "http://localhost:11434/v1") : config.baseUrl,
    };
  }

  /** Run the consistency guard, then build (or reuse) the OpenAI client. */
  private ensureClient(): OpenAI {
    this.deps.beforeFirstUse?.();
    this.client ??= new OpenAI(this.clientOptions);
    return this.client;
  }

  async embedStale(opts?: { limit?: number }): Promise<{ embedded: number; errors: number }> {
    const client = this.ensureClient();
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
        const response = await client.embeddings.create({
          model: this.model,
          input: texts,
          dimensions: this.dimensions,
        });
        for (let j = 0; j < batch.length; j++) {
          const vec = response.data[j].embedding;
          const vecStr = `[${vec.join(",")}]`;
          await this.pg.query(
            `UPDATE content_chunks SET embedding = $1::vector, model = $2, embedded_at = NOW() WHERE id = $3`,
            [vecStr, this.model, batch[j].id],
          );
          embedded++;
        }
      } catch (_err) {
        errors += batch.length;
      }
    }
    return { embedded, errors };
  }

  async embedText(text: string): Promise<number[]> {
    const client = this.ensureClient();
    const response = await client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });
    return response.data[0].embedding;
  }
}

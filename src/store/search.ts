import type { PGlite } from "@electric-sql/pglite";

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
}

export class SearchEngine {
  constructor(private pg: PGlite) {}

  async search(
    query: string,
    opts?: { limit?: number }
  ): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 20;

    const tsquery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-zA-Z0-9一-鿿]/g, ""))
      .filter(Boolean)
      .join(" & ");

    if (!tsquery) return [];

    const result = await this.pg.query(
      `SELECT
         p.slug,
         p.title,
         p.type,
         ts_rank(p.search_vector, to_tsquery('simple', $1)) AS page_rank,
         COALESCE(
           ts_headline('simple', p.compiled_truth, to_tsquery('simple', $1),
             'MaxWords=30, MinWords=15, StartSel=**, StopSel=**'),
           ''
         ) AS snippet
       FROM pages p
       WHERE p.search_vector @@ to_tsquery('simple', $1)
       ORDER BY page_rank DESC
       LIMIT $2`,
      [tsquery, limit]
    );

    return result.rows.map((row: any) => ({
      slug: row.slug,
      title: row.title,
      type: row.type,
      snippet: row.snippet,
      score: Number(row.page_rank),
    }));
  }
}

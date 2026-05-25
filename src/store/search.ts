import type { PGlite } from "@electric-sql/pglite";

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
}

interface SearchEngineOpts {
  embedText?: (text: string) => Promise<number[]>;
}

const RRF_K = 60;
const COMPILED_TRUTH_BOOST = 2.0;
const BACKLINK_BOOST_FACTOR = 0.05;

export class SearchEngine {
  private embedText?: (text: string) => Promise<number[]>;

  constructor(private pg: PGlite, opts?: SearchEngineOpts) {
    this.embedText = opts?.embedText;
  }

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

  async query(
    query: string,
    opts?: { limit?: number }
  ): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 20;
    const [ftsResults, vectorResults] = await Promise.all([
      this.ftsChunkSearch(query),
      this.vectorSearch(query),
    ]);

    const scoreMap = new Map<string, {
      slug: string; title: string; type: string; snippet: string; score: number; chunk_source: string;
    }>();

    const addRanked = (
      results: Array<{ slug: string; title: string; type: string; snippet: string; chunk_source: string }>,
    ) => {
      for (let rank = 0; rank < results.length; rank++) {
        const r = results[rank];
        const rrfScore = 1 / (RRF_K + rank + 1);
        const existing = scoreMap.get(r.slug);
        const newScore = (existing?.score ?? 0) + rrfScore;
        if (!existing || newScore > existing.score) {
          scoreMap.set(r.slug, {
            slug: r.slug, title: r.title, type: r.type,
            snippet: existing?.snippet || r.snippet, score: newScore, chunk_source: r.chunk_source,
          });
        } else {
          existing.score = newScore;
        }
      }
    };

    addRanked(ftsResults);
    addRanked(vectorResults);

    for (const entry of scoreMap.values()) {
      if (entry.chunk_source === "compiled_truth") {
        entry.score *= COMPILED_TRUTH_BOOST;
      }
    }

    const slugs = [...scoreMap.keys()];
    if (slugs.length > 0) {
      for (const slug of slugs) {
        const bl = await this.pg.query(
          `SELECT COUNT(*) AS cnt FROM links l JOIN pages p ON p.id = l.to_page_id WHERE p.slug = $1`,
          [slug]
        );
        const backlinkCount = Number(bl.rows[0].cnt);
        if (backlinkCount > 0) {
          const entry = scoreMap.get(slug)!;
          entry.score *= 1 + BACKLINK_BOOST_FACTOR * Math.log(1 + backlinkCount);
        }
      }
    }

    return [...scoreMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ chunk_source: _, ...rest }) => rest);
  }

  private async ftsChunkSearch(
    query: string
  ): Promise<Array<{ slug: string; title: string; type: string; snippet: string; chunk_source: string }>> {
    const tsquery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-zA-Z0-9一-鿿]/g, ""))
      .filter(Boolean)
      .join(" & ");

    if (!tsquery) return [];

    const result = await this.pg.query(
      `SELECT p.slug, p.title, p.type, cc.chunk_source,
         ts_rank(cc.search_vector, to_tsquery('simple', $1)) AS chunk_rank,
         ts_headline('simple', cc.chunk_text, to_tsquery('simple', $1),
           'MaxWords=30, MinWords=15, StartSel=**, StopSel=**') AS snippet
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE cc.search_vector @@ to_tsquery('simple', $1)
       ORDER BY chunk_rank DESC LIMIT 50`,
      [tsquery]
    );
    return result.rows as any[];
  }

  private async vectorSearch(
    query: string
  ): Promise<Array<{ slug: string; title: string; type: string; snippet: string; chunk_source: string }>> {
    if (!this.embedText) return [];
    const queryVec = await this.embedText(query);
    const vecStr = "[" + queryVec.join(",") + "]";
    const result = await this.pg.query(
      `SELECT p.slug, p.title, p.type, cc.chunk_source,
         cc.chunk_text AS snippet, 1 - (cc.embedding <=> $1::vector) AS cosine_sim
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE cc.embedding IS NOT NULL
       ORDER BY cc.embedding <=> $1::vector LIMIT 50`,
      [vecStr]
    );
    return result.rows as any[];
  }
}

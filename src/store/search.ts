import type { PGlite } from "@electric-sql/pglite";

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
  highlights: string[];
}

export interface SearchFilterOpts {
  limit?: number;
  type?: string[];
  from?: string;
  to?: string;
  platform?: string;
  exclude_types?: string[];
}

interface SearchEngineOpts {
  embedText?: (text: string) => Promise<number[]>;
}

interface PageSearchRow {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  page_rank: number | string;
}

interface ChunkSearchRow {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  chunk_source: string;
  updated_at: string | null;
}

interface CountRow {
  cnt: number | string;
}

const RRF_K = 60;
const COMPILED_TRUTH_BOOST = 2.0;
const BACKLINK_BOOST_FACTOR = 0.05;
const FRESHNESS_HALF_LIFE_DAYS = 90;
const FRESHNESS_BOOST_FACTOR = 0.3;

/**
 * Compute freshness multiplier using exponential decay.
 * Returns 1.0 for missing timestamps (no effect).
 * Exported for unit testing.
 */
export function freshnessMultiplier(updatedAt: string | null): number {
  if (!updatedAt) return 1.0;
  // Clamp to >=0 so future timestamps (clock skew, calendar events) cap at the boost ceiling
  // instead of producing exp(-negative) > 1 which exceeds the intended 1.3 limit.
  const ageDays = Math.max(
    0,
    (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  return 1 + FRESHNESS_BOOST_FACTOR * Math.exp(-ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

export class SearchEngine {
  private embedText?: (text: string) => Promise<number[]>;

  constructor(
    private pg: PGlite,
    opts?: SearchEngineOpts,
  ) {
    this.embedText = opts?.embedText;
  }

  async search(query: string, opts?: SearchFilterOpts): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 20;

    const tsquery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-zA-Z0-9一-鿿]/g, ""))
      .filter(Boolean)
      .join(" & ");

    if (!tsquery) return [];

    const conditions: string[] = ["p.search_vector @@ to_tsquery('simple', $1)"];
    const params: unknown[] = [tsquery];
    let paramIndex = 2;

    if (opts?.type && opts.type.length > 0) {
      conditions.push(`p.type = ANY($${paramIndex}::text[])`);
      params.push(opts.type);
      paramIndex++;
    }

    if (opts?.exclude_types && opts.exclude_types.length > 0) {
      conditions.push(`p.type != ALL($${paramIndex}::text[])`);
      params.push(opts.exclude_types);
      paramIndex++;
    }

    if (opts?.from) {
      conditions.push(
        `COALESCE(p.frontmatter->'source'->>'timestamp', p.frontmatter->'first_seen'->>'timestamp', p.created_at::text)::timestamptz >= $${paramIndex}::timestamptz`,
      );
      params.push(opts.from);
      paramIndex++;
    }

    if (opts?.to) {
      conditions.push(
        `COALESCE(p.frontmatter->'source'->>'timestamp', p.frontmatter->'first_seen'->>'timestamp', p.created_at::text)::timestamptz <= ($${paramIndex}::date + interval '1 day')::timestamptz`,
      );
      params.push(opts.to);
      paramIndex++;
    }

    if (opts?.platform) {
      conditions.push(
        `COALESCE(p.frontmatter->'source'->>'platform', p.frontmatter->'first_seen'->>'platform') = $${paramIndex}`,
      );
      params.push(opts.platform);
      paramIndex++;
    }

    params.push(limit);

    const result = await this.pg.query<PageSearchRow>(
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
       WHERE ${conditions.join(" AND ")}
       ORDER BY page_rank DESC
       LIMIT $${paramIndex}`,
      params,
    );

    return result.rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      type: row.type,
      snippet: row.snippet,
      score: Number(row.page_rank),
      highlights: row.snippet ? [row.snippet] : [],
    }));
  }

  async query(query: string, opts?: SearchFilterOpts): Promise<SearchResult[]> {
    const limit = opts?.limit ?? 20;
    const [ftsResults, vectorResults] = await Promise.all([
      this.ftsChunkSearch(query),
      this.vectorSearch(query),
    ]);

    const scoreMap = new Map<
      string,
      {
        slug: string;
        title: string;
        type: string;
        snippet: string;
        score: number;
        chunk_source: string;
        updated_at: string | null;
      }
    >();

    const addRanked = (
      results: Array<{
        slug: string;
        title: string;
        type: string;
        snippet: string;
        chunk_source: string;
        updated_at: string | null;
      }>,
    ) => {
      for (let rank = 0; rank < results.length; rank++) {
        const r = results[rank];
        const rrfScore = 1 / (RRF_K + rank + 1);
        const existing = scoreMap.get(r.slug);
        const newScore = (existing?.score ?? 0) + rrfScore;
        if (!existing || newScore > existing.score) {
          scoreMap.set(r.slug, {
            slug: r.slug,
            title: r.title,
            type: r.type,
            snippet: existing?.snippet || r.snippet,
            score: newScore,
            chunk_source: r.chunk_source,
            updated_at: r.updated_at,
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
        const bl = await this.pg.query<CountRow>(
          `SELECT COUNT(*) AS cnt FROM links l JOIN pages p ON p.id = l.to_page_id WHERE p.slug = $1`,
          [slug],
        );
        const backlinkCount = Number(bl.rows[0]?.cnt ?? 0);
        if (backlinkCount > 0) {
          const entry = scoreMap.get(slug);
          if (entry) {
            entry.score *= 1 + BACKLINK_BOOST_FACTOR * Math.log(1 + backlinkCount);
          }
        }
      }
    }

    // Apply freshness boost
    for (const entry of scoreMap.values()) {
      entry.score *= freshnessMultiplier(entry.updated_at);
    }

    let results = [...scoreMap.values()].sort((a, b) => b.score - a.score);

    // Post-filter by type and exclude_types
    if (opts?.type && opts.type.length > 0) {
      const typeSet = new Set(opts.type);
      results = results.filter((r) => typeSet.has(r.type));
    }

    if (opts?.exclude_types && opts.exclude_types.length > 0) {
      const excludeSet = new Set(opts.exclude_types);
      results = results.filter((r) => !excludeSet.has(r.type));
    }

    return results.slice(0, limit).map(({ chunk_source: _, updated_at: __, snippet, ...rest }) => ({
      ...rest,
      snippet,
      highlights: snippet ? [snippet] : [],
    }));
  }

  private async ftsChunkSearch(
    query: string,
  ): Promise<
    Array<{
      slug: string;
      title: string;
      type: string;
      snippet: string;
      chunk_source: string;
      updated_at: string | null;
    }>
  > {
    const tsquery = query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.replace(/[^a-zA-Z0-9一-鿿]/g, ""))
      .filter(Boolean)
      .join(" & ");

    if (!tsquery) return [];

    const result = await this.pg.query<ChunkSearchRow>(
      `SELECT p.slug, p.title, p.type, cc.chunk_source, p.updated_at,
         ts_rank(cc.search_vector, to_tsquery('simple', $1)) AS chunk_rank,
         ts_headline('simple', cc.chunk_text, to_tsquery('simple', $1),
           'MaxWords=30, MinWords=15, StartSel=**, StopSel=**') AS snippet
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE cc.search_vector @@ to_tsquery('simple', $1)
       ORDER BY chunk_rank DESC LIMIT 50`,
      [tsquery],
    );
    return result.rows;
  }

  private async vectorSearch(
    query: string,
  ): Promise<
    Array<{
      slug: string;
      title: string;
      type: string;
      snippet: string;
      chunk_source: string;
      updated_at: string | null;
    }>
  > {
    if (!this.embedText) return [];
    const queryVec = await this.embedText(query);
    const vecStr = `[${queryVec.join(",")}]`;
    const result = await this.pg.query<ChunkSearchRow>(
      `SELECT p.slug, p.title, p.type, cc.chunk_source, p.updated_at,
         cc.chunk_text AS snippet, 1 - (cc.embedding <=> $1::vector) AS cosine_sim
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE cc.embedding IS NOT NULL
       ORDER BY cc.embedding <=> $1::vector LIMIT 50`,
      [vecStr],
    );
    return result.rows;
  }
}

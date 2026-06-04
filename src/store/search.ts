import type { PGlite } from "@electric-sql/pglite";
import type { MemoryFilter, SourceRef } from "../core/types.js";

export interface SearchResult {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  score: number;
  highlights: string[];
  provenance?: SourceRef;
}

export type SearchFilterOpts = MemoryFilter;

interface SearchEngineOpts {
  embedText?: (text: string) => Promise<number[]>;
}

interface PageSearchRow {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  page_rank: number | string;
  provenance: SourceRef | string | null;
}

interface ChunkSearchRow {
  slug: string;
  title: string;
  type: string;
  snippet: string;
  chunk_source: string;
  provenance: SourceRef | string | null;
}

interface CountRow {
  cnt: number | string;
}

const RRF_K = 60;
const COMPILED_TRUTH_BOOST = 2.0;
const BACKLINK_BOOST_FACTOR = 0.05;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;

function clampLimit(limit: number | undefined, defaultLimit = DEFAULT_SEARCH_LIMIT): number {
  if (!Number.isFinite(limit) || (limit ?? 0) <= 0) return defaultLimit;
  return Math.min(Math.floor(limit as number), MAX_SEARCH_LIMIT);
}

function asArray(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

function sourceField(alias: string, field: string): string {
  return `COALESCE(${alias}.frontmatter->'source'->>'${field}', ${alias}.frontmatter->'first_seen'->>'${field}')`;
}

function sourceJson(alias: string): string {
  return `COALESCE(${alias}.frontmatter->'source', ${alias}.frontmatter->'first_seen')`;
}

function addMemoryFilterConditions(
  conditions: string[],
  params: unknown[],
  opts: SearchFilterOpts | undefined,
  pageAlias = "p",
): void {
  const addArrayCondition = (field: "platform" | "source_type") => {
    const values = asArray(opts?.[field]);
    if (!values || values.length === 0) return;
    params.push(values);
    conditions.push(`${sourceField(pageAlias, field)} = ANY($${params.length}::text[])`);
  };

  addArrayCondition("platform");
  addArrayCondition("source_type");

  if (opts?.channel) {
    params.push(opts.channel);
    conditions.push(`${sourceField(pageAlias, "channel")} = $${params.length}`);
  }

  if (opts?.channel_name) {
    params.push(opts.channel_name);
    conditions.push(`${sourceField(pageAlias, "channel_name")} = $${params.length}`);
  }

  if (opts?.participant) {
    params.push(opts.participant);
    const param = `$${params.length}`;
    conditions.push(`(
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(${sourceJson(pageAlias)}->'participants', '[]'::jsonb)) AS participant
        WHERE participant->>'name' = ${param} OR participant->>'id' = ${param}
      )
      OR ${sourceJson(pageAlias)}->'author'->>'name' = ${param}
      OR ${sourceJson(pageAlias)}->'author'->>'id' = ${param}
    )`);
  }

  if (opts?.type && opts.type.length > 0) {
    params.push(opts.type);
    conditions.push(`${pageAlias}.type = ANY($${params.length}::text[])`);
  }

  if (opts?.exclude_types && opts.exclude_types.length > 0) {
    params.push(opts.exclude_types);
    conditions.push(`${pageAlias}.type != ALL($${params.length}::text[])`);
  }

  if (opts?.from) {
    params.push(opts.from);
    conditions.push(
      `COALESCE(${sourceField(pageAlias, "timestamp")}, ${pageAlias}.created_at::text)::timestamptz >= $${params.length}::timestamptz`,
    );
  }

  if (opts?.to) {
    params.push(opts.to);
    conditions.push(
      `COALESCE(${sourceField(pageAlias, "timestamp")}, ${pageAlias}.created_at::text)::timestamptz <= ($${params.length}::date + interval '1 day')::timestamptz`,
    );
  }
}

function parseProvenance(value: SourceRef | string | null): SourceRef | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as SourceRef;
    } catch {
      return undefined;
    }
  }
  return value;
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
    const limit = clampLimit(opts?.limit);

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

    addMemoryFilterConditions(conditions, params, opts, "p");
    paramIndex = params.length + 1;

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
         ) AS snippet,
         ${sourceJson("p")} AS provenance
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
      provenance: parseProvenance(row.provenance),
    }));
  }

  async query(query: string, opts?: SearchFilterOpts): Promise<SearchResult[]> {
    const limit = clampLimit(opts?.limit);
    const [ftsResults, vectorResults] = await Promise.all([
      this.ftsChunkSearch(query, opts),
      this.vectorSearch(query, opts),
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
        provenance?: SourceRef;
      }
    >();

    const addRanked = (
      results: Array<{
        slug: string;
        title: string;
        type: string;
        snippet: string;
        chunk_source: string;
        provenance: SourceRef | string | null;
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
            provenance: parseProvenance(r.provenance),
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

    const results = [...scoreMap.values()].sort((a, b) => b.score - a.score);

    return results.slice(0, limit).map(({ chunk_source: _, snippet, ...rest }) => ({
      ...rest,
      snippet,
      highlights: snippet ? [snippet] : [],
    }));
  }

  private async ftsChunkSearch(
    query: string,
    opts?: SearchFilterOpts,
  ): Promise<
    Array<{
      slug: string;
      title: string;
      type: string;
      snippet: string;
      chunk_source: string;
      provenance: SourceRef | string | null;
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

    const conditions = ["cc.search_vector @@ to_tsquery('simple', $1)"];
    const params: unknown[] = [tsquery];
    addMemoryFilterConditions(conditions, params, opts, "p");

    const result = await this.pg.query<ChunkSearchRow>(
      `SELECT p.slug, p.title, p.type, cc.chunk_source,
         ts_rank(cc.search_vector, to_tsquery('simple', $1)) AS chunk_rank,
         ts_headline('simple', cc.chunk_text, to_tsquery('simple', $1),
           'MaxWords=30, MinWords=15, StartSel=**, StopSel=**') AS snippet,
         ${sourceJson("p")} AS provenance
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY chunk_rank DESC LIMIT 50`,
      params,
    );
    return result.rows;
  }

  private async vectorSearch(
    query: string,
    opts?: SearchFilterOpts,
  ): Promise<
    Array<{
      slug: string;
      title: string;
      type: string;
      snippet: string;
      chunk_source: string;
      provenance: SourceRef | string | null;
    }>
  > {
    if (!this.embedText) return [];
    const queryVec = await this.embedText(query);
    const vecStr = `[${queryVec.join(",")}]`;
    const conditions = ["cc.embedding IS NOT NULL"];
    const params: unknown[] = [vecStr];
    addMemoryFilterConditions(conditions, params, opts, "p");
    const result = await this.pg.query<ChunkSearchRow>(
      `SELECT p.slug, p.title, p.type, cc.chunk_source,
         cc.chunk_text AS snippet, 1 - (cc.embedding <=> $1::vector) AS cosine_sim,
         ${sourceJson("p")} AS provenance
       FROM content_chunks cc JOIN pages p ON p.id = cc.page_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY cc.embedding <=> $1::vector LIMIT 50`,
      params,
    );
    return result.rows;
  }
}

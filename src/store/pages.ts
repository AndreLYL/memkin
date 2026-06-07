import { createHash } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { parse as parseYaml } from "yaml";

export interface Page {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
  content_hash: string;
  halflife_days: number | null;
  created_at: string;
  updated_at: string;
}

export interface PutPageOptions {
  halflife_days?: number | null;
}

interface ParsedContent {
  title: string;
  type: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
}

interface PageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown> | string;
  content_hash: string;
  halflife_days: number | null;
  created_at: string;
  updated_at: string;
}

function parseMarkdownWithFrontmatter(content: string): ParsedContent {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { title: "", type: "unknown", compiled_truth: content.trim(), frontmatter: {} };
  }
  const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
  const body = fmMatch[2].trim();
  const title = String(fm.title ?? "");
  const type = String(fm.type ?? "unknown");

  const { title: _t, type: _ty, ...rest } = fm;

  return { title, type, compiled_truth: body, frontmatter: rest };
}

export class PageStore {
  constructor(private pg: PGlite) {}

  async putPage(slug: string, content: string, opts?: PutPageOptions): Promise<Page> {
    const { title, type, compiled_truth, frontmatter } = parseMarkdownWithFrontmatter(content);
    const contentHash = createHash("sha256").update(content).digest("hex");
    // putPage always stamps the full lifecycle state: omitting opts.halflife_days
    // intentionally resets the column to NULL on conflict (not a partial merge).
    const halflifeDays = opts?.halflife_days ?? null;

    const result = await this.pg.query<PageRow>(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash, halflife_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (slug) DO UPDATE SET
         type = EXCLUDED.type,
         title = EXCLUDED.title,
         compiled_truth = EXCLUDED.compiled_truth,
         frontmatter = EXCLUDED.frontmatter,
         content_hash = EXCLUDED.content_hash,
         halflife_days = EXCLUDED.halflife_days,
         updated_at = NOW()
       RETURNING *`,
      [slug, type, title, compiled_truth, JSON.stringify(frontmatter), contentHash, halflifeDays],
    );
    return this.rowToPage(result.rows[0]);
  }

  async getPage(slug: string): Promise<Page | null> {
    const result = await this.pg.query<PageRow>("SELECT * FROM pages WHERE slug = $1", [slug]);
    return result.rows.length > 0 ? this.rowToPage(result.rows[0]) : null;
  }

  async deletePage(slug: string): Promise<void> {
    await this.pg.query("DELETE FROM pages WHERE slug = $1", [slug]);
  }

  async listPages(opts?: {
    type?: string;
    exclude_types?: string[];
    limit?: number;
    sort?: string;
    order?: string;
  }): Promise<Page[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (opts?.type) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(opts.type);
    }
    if (opts?.exclude_types && opts.exclude_types.length > 0) {
      conditions.push(`type != ALL($${params.length + 1}::text[])`);
      params.push(opts.exclude_types);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const sortDir = opts?.order === "asc" ? "ASC" : "DESC";

    let sql: string;
    if (opts?.sort === "backlinks") {
      sql = `SELECT p.* FROM pages p
        LEFT JOIN (
          SELECT to_page_id, COUNT(*) AS cnt FROM links GROUP BY to_page_id
        ) lc ON lc.to_page_id = p.id${whereClause}
        ORDER BY COALESCE(lc.cnt, 0) ${sortDir}`;
    } else if (opts?.sort === "signal_time") {
      sql = `SELECT * FROM pages${whereClause}
        ORDER BY COALESCE(
          frontmatter->'source'->>'timestamp',
          frontmatter->'first_seen'->>'timestamp',
          created_at::text
        ) ${sortDir}`;
    } else {
      const sortCol = ["updated_at", "created_at", "title"].includes(opts?.sort ?? "")
        ? (opts?.sort ?? "updated_at")
        : "updated_at";
      sql = `SELECT * FROM pages${whereClause} ORDER BY ${sortCol} ${sortDir}`;
    }

    if (opts?.limit) {
      sql += ` LIMIT $${params.length + 1}`;
      params.push(opts.limit);
    }

    const result = await this.pg.query<PageRow>(sql, params);
    return result.rows.map((r) => this.rowToPage(r));
  }

  private rowToPage(row: PageRow): Page {
    return {
      id: row.id,
      slug: row.slug,
      type: row.type,
      title: row.title,
      compiled_truth: row.compiled_truth,
      frontmatter:
        typeof row.frontmatter === "string" ? JSON.parse(row.frontmatter) : row.frontmatter,
      content_hash: row.content_hash,
      halflife_days: row.halflife_days,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

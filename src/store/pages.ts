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
  tier: string;
  expires_at: string | null;
  consolidated_into: number | null;
  created_at: string;
  updated_at: string;
}

export interface PutPageOptions {
  halflife_days?: number | null;
  expires_at?: Date | null; // explicit override; null clears it; undefined = auto-compute from halflife_days
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
  tier: string;
  expires_at: string | null;
  consolidated_into: number | null;
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
    const halflifeDays = opts?.halflife_days ?? null;

    // Compute expires_at in TS to correctly handle the three-way distinction:
    // - explicit Date: use that value
    // - explicit null: store NULL (clear it)
    // - undefined: auto-compute from halflife_days, or NULL if halflife_days is null
    let expiresAt: Date | null;
    if (opts?.expires_at !== undefined) {
      expiresAt = opts.expires_at; // Date or null, both stored as-is
    } else if (halflifeDays !== null) {
      expiresAt = new Date(Date.now() + halflifeDays * 86_400_000);
    } else {
      expiresAt = null;
    }

    const result = await this.pg.query<PageRow>(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash, halflife_days, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
       ON CONFLICT (slug) DO UPDATE SET
         type = EXCLUDED.type,
         title = EXCLUDED.title,
         compiled_truth = EXCLUDED.compiled_truth,
         frontmatter = EXCLUDED.frontmatter,
         content_hash = EXCLUDED.content_hash,
         halflife_days = EXCLUDED.halflife_days,
         updated_at = NOW()
       RETURNING *`,
      [
        slug,
        type,
        title,
        compiled_truth,
        JSON.stringify(frontmatter),
        contentHash,
        halflifeDays,
        expiresAt,
      ],
    );
    return this.rowToPage(result.rows[0]);
  }

  async getPage(slug: string): Promise<Page | null> {
    const result = await this.pg.query<PageRow>("SELECT * FROM pages WHERE slug = $1", [slug]);
    return result.rows.length > 0 ? this.rowToPage(result.rows[0]) : null;
  }

  /** Merge a synth cache entry into frontmatter.synth[intent] WITHOUT bumping updated_at or re-chunking. Returns false if the page does not exist. */
  async setSynthCache(slug: string, intent: string, entry: unknown): Promise<boolean> {
    const page = await this.getPage(slug);
    if (!page) return false;
    const fm = { ...(page.frontmatter as Record<string, unknown>) };
    const synth = (fm.synth as Record<string, unknown> | undefined) ?? {};
    synth[intent] = entry;
    fm.synth = synth;
    await this.pg.query("UPDATE pages SET frontmatter = $2 WHERE slug = $1", [
      slug,
      JSON.stringify(fm),
    ]);
    return true;
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

  async listExpiredHot(): Promise<Page[]> {
    const result = await this.pg.query<PageRow>(
      `SELECT * FROM pages
       WHERE tier = 'hot'
         AND expires_at IS NOT NULL
         AND expires_at < NOW()
       ORDER BY expires_at`,
    );
    return result.rows.map((r) => this.rowToPage(r));
  }

  async updatePageTier(id: number, tier: string, consolidatedInto?: number | null): Promise<void> {
    if (consolidatedInto !== undefined) {
      await this.pg.query(
        `UPDATE pages SET tier = $1, consolidated_into = $2, updated_at = NOW() WHERE id = $3`,
        [tier, consolidatedInto, id],
      );
    } else {
      await this.pg.query(`UPDATE pages SET tier = $1, updated_at = NOW() WHERE id = $2`, [
        tier,
        id,
      ]);
    }
  }

  async listPagesByTier(tier: string): Promise<Page[]> {
    const result = await this.pg.query<PageRow>(
      `SELECT * FROM pages WHERE tier = $1 ORDER BY created_at`,
      [tier],
    );
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
      tier: row.tier ?? "hot",
      expires_at: row.expires_at ?? null,
      consolidated_into: row.consolidated_into ?? null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

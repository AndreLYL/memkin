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
  created_at: string;
  updated_at: string;
}

interface ParsedContent {
  title: string;
  type: string;
  compiled_truth: string;
  frontmatter: Record<string, unknown>;
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

  async putPage(slug: string, content: string): Promise<Page> {
    const { title, type, compiled_truth, frontmatter } = parseMarkdownWithFrontmatter(content);
    const contentHash = createHash("sha256").update(content).digest("hex");

    const result = await this.pg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE SET
         type = EXCLUDED.type,
         title = EXCLUDED.title,
         compiled_truth = EXCLUDED.compiled_truth,
         frontmatter = EXCLUDED.frontmatter,
         content_hash = EXCLUDED.content_hash,
         updated_at = NOW()
       RETURNING *`,
      [slug, type, title, compiled_truth, JSON.stringify(frontmatter), contentHash],
    );
    return this.rowToPage(result.rows[0]);
  }

  async getPage(slug: string): Promise<Page | null> {
    const result = await this.pg.query("SELECT * FROM pages WHERE slug = $1", [slug]);
    return result.rows.length > 0 ? this.rowToPage(result.rows[0]) : null;
  }

  async deletePage(slug: string): Promise<void> {
    await this.pg.query("DELETE FROM pages WHERE slug = $1", [slug]);
  }

  async listPages(opts?: {
    type?: string;
    limit?: number;
    sort?: string;
    order?: string;
  }): Promise<Page[]> {
    let sql = "SELECT * FROM pages";
    const params: unknown[] = [];
    const conditions: string[] = [];

    if (opts?.type) {
      conditions.push(`type = $${params.length + 1}`);
      params.push(opts.type);
    }
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    const validSorts = ["updated_at", "created_at", "title"];
    const sortCol = validSorts.includes(opts?.sort ?? "") ? opts!.sort! : "updated_at";
    const order = opts?.order === "asc" ? "ASC" : "DESC";
    sql += ` ORDER BY ${sortCol} ${order}`;

    // limit=0 means no limit; undefined/negative → default 50; cap at 200
    const rawLimit = opts?.limit;
    if (rawLimit === 0) {
      // no LIMIT clause — return all
    } else {
      const limit = (rawLimit && rawLimit > 0) ? Math.min(rawLimit, 200) : 50;
      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);
    }

    const result = await this.pg.query(sql, params);
    return result.rows.map((r: any) => this.rowToPage(r));
  }

  private rowToPage(row: any): Page {
    return {
      id: row.id,
      slug: row.slug,
      type: row.type,
      title: row.title,
      compiled_truth: row.compiled_truth,
      frontmatter:
        typeof row.frontmatter === "string" ? JSON.parse(row.frontmatter) : row.frontmatter,
      content_hash: row.content_hash,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

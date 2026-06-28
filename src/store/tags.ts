import type { SqlConn } from "./sql-executor.js";

interface TagRow {
  tag: string;
}

interface InsertRow {
  id: number;
}

export class TagStore {
  constructor(private pg: SqlConn) {}

  async addTag(slug: string, tag: string): Promise<void> {
    const result = await this.pg.query<InsertRow>(
      `INSERT INTO tags (page_id, tag)
       SELECT id, $2 FROM pages WHERE slug = $1
       ON CONFLICT (page_id, tag) DO UPDATE SET tag = EXCLUDED.tag
       RETURNING id`,
      [slug, tag],
    );
    if (result.rows.length === 0) {
      throw new Error(`Page not found: ${slug}`);
    }
  }

  async removeTag(slug: string, tag: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM tags WHERE page_id = (SELECT id FROM pages WHERE slug = $1) AND tag = $2`,
      [slug, tag],
    );
  }

  async getTags(slug: string): Promise<string[]> {
    const result = await this.pg.query<TagRow>(
      `SELECT t.tag FROM tags t JOIN pages p ON p.id = t.page_id WHERE p.slug = $1 ORDER BY t.tag`,
      [slug],
    );
    return result.rows.map((r) => r.tag);
  }

  async getAllTagsGrouped(): Promise<Map<string, string[]>> {
    const result = await this.pg.query<{ slug: string; tag: string }>(
      `SELECT p.slug, t.tag FROM tags t JOIN pages p ON p.id = t.page_id ORDER BY p.slug, t.tag`,
    );
    const grouped = new Map<string, string[]>();
    for (const row of result.rows) {
      const list = grouped.get(row.slug);
      if (list) list.push(row.tag);
      else grouped.set(row.slug, [row.tag]);
    }
    return grouped;
  }
}

import type { PGlite } from "@electric-sql/pglite";
import type { Queryable } from "./database.js";

interface TagRow {
  tag: string;
}

export class TagStore {
  constructor(private pg: PGlite) {}

  async addTag(slug: string, tag: string, exec?: Queryable): Promise<void> {
    const db = exec ?? this.pg;
    await db.query(
      `INSERT INTO tags (page_id, tag)
       SELECT id, $2 FROM pages WHERE slug = $1
       ON CONFLICT (page_id, tag) DO NOTHING`,
      [slug, tag],
    );
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
}

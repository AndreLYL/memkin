import type { PGlite } from "@electric-sql/pglite";
import type { SourceRef } from "../core/types.js";

export interface LinkRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  provenance?: SourceRef;
}

export interface GraphNode {
  slug: string;
  title: string;
  type: string;
  depth: number;
}

interface SlugRow {
  slug: string;
}

interface PageSummaryRow {
  slug: string;
  title: string;
  type: string;
}

export class GraphStore {
  constructor(private pg: PGlite) {}

  async addLink(
    fromSlug: string,
    toSlug: string,
    type: string,
    context?: string,
    provenance?: SourceRef,
    sourceHash?: string,
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO links (from_page_id, to_page_id, link_type, context, provenance, source_hash)
       SELECT f.id, t.id, $3, $4, $5, $6
       FROM pages f, pages t
       WHERE f.slug = $1 AND t.slug = $2
       ON CONFLICT (from_page_id, to_page_id, link_type) DO UPDATE SET context = EXCLUDED.context`,
      [
        fromSlug,
        toSlug,
        type,
        context ?? "",
        provenance ? JSON.stringify(provenance) : null,
        sourceHash ?? null,
      ],
    );
  }

  async removeLink(fromSlug: string, toSlug: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM links
       WHERE from_page_id = (SELECT id FROM pages WHERE slug = $1)
         AND to_page_id = (SELECT id FROM pages WHERE slug = $2)`,
      [fromSlug, toSlug],
    );
  }

  async getLinks(slug: string): Promise<LinkRow[]> {
    const result = await this.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pf.slug = $1`,
      [slug],
    );
    return result.rows as LinkRow[];
  }

  async getBacklinks(slug: string): Promise<LinkRow[]> {
    const result = await this.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pt.slug = $1`,
      [slug],
    );
    return result.rows as LinkRow[];
  }

  async traverse(
    slug: string,
    opts?: { depth?: number; direction?: "in" | "out" | "both" },
  ): Promise<GraphNode[]> {
    const maxDepth = Math.min(opts?.depth ?? 5, 10);
    const direction = opts?.direction ?? "out";
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    let frontier = [slug];
    visited.add(slug);

    for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        const neighbors: string[] = [];
        if (direction === "out" || direction === "both") {
          const out = await this.pg.query<SlugRow>(
            `SELECT pt.slug FROM links l JOIN pages pt ON pt.id = l.to_page_id
             WHERE l.from_page_id = (SELECT id FROM pages WHERE slug = $1)`,
            [current],
          );
          neighbors.push(...out.rows.map((r) => r.slug));
        }
        if (direction === "in" || direction === "both") {
          const inc = await this.pg.query<SlugRow>(
            `SELECT pf.slug FROM links l JOIN pages pf ON pf.id = l.from_page_id
             WHERE l.to_page_id = (SELECT id FROM pages WHERE slug = $1)`,
            [current],
          );
          neighbors.push(...inc.rows.map((r) => r.slug));
        }
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            nextFrontier.push(n);
            const page = await this.pg.query<PageSummaryRow>(
              "SELECT slug, title, type FROM pages WHERE slug = $1",
              [n],
            );
            if (page.rows.length > 0) {
              const p = page.rows[0];
              result.push({ slug: p.slug, title: p.title, type: p.type, depth: d });
            }
          }
        }
      }
      frontier = nextFrontier;
    }
    return result;
  }
}

import type { PGlite } from "@electric-sql/pglite";
import { compactSourceRef } from "../core/source-ref.js";
import type { SourceRef } from "../core/types.js";

export interface LinkRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  provenance?: SourceRef;
}

export interface EnrichedLinkRow extends LinkRow {
  page: { title: string; type: string; frontmatter: Record<string, unknown> };
}

export interface GraphNode {
  slug: string;
  title: string;
  type: string;
  depth: number;
}

export interface GraphEdge {
  from_slug: string;
  to_slug: string;
  link_type: string;
}

export interface TraverseResult {
  focus: { slug: string; title: string; type: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface LinkTypeRow {
  slug: string;
  link_type: string;
}

interface PageSummaryRow {
  slug: string;
  title: string;
  type: string;
}

interface EnrichedLinkRawRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  provenance?: string;
  page_title: string;
  page_type: string;
  page_frontmatter: string | Record<string, unknown>;
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
        provenance ? JSON.stringify(compactSourceRef(provenance)) : null,
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

  async getLinksEnriched(slug: string): Promise<EnrichedLinkRow[]> {
    const result = await this.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance,
              pt.title AS page_title, pt.type AS page_type, pt.frontmatter AS page_frontmatter
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pf.slug = $1`,
      [slug],
    );
    return (result.rows as EnrichedLinkRawRow[]).map((r) => {
      const frontmatter =
        typeof r.page_frontmatter === "string"
          ? JSON.parse(r.page_frontmatter)
          : r.page_frontmatter;

      return {
        from_slug: r.from_slug,
        to_slug: r.to_slug,
        link_type: r.link_type,
        context: r.context,
        provenance: r.provenance ? (JSON.parse(r.provenance) as SourceRef) : undefined,
        page: {
          title: r.page_title,
          type: r.page_type,
          frontmatter: (frontmatter as Record<string, unknown>) ?? {},
        },
      };
    });
  }

  async getBacklinksEnriched(slug: string): Promise<EnrichedLinkRow[]> {
    const result = await this.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance,
              pf.title AS page_title, pf.type AS page_type, pf.frontmatter AS page_frontmatter
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pt.slug = $1`,
      [slug],
    );
    return (result.rows as EnrichedLinkRawRow[]).map((r) => {
      const frontmatter =
        typeof r.page_frontmatter === "string"
          ? JSON.parse(r.page_frontmatter)
          : r.page_frontmatter;

      return {
        from_slug: r.from_slug,
        to_slug: r.to_slug,
        link_type: r.link_type,
        context: r.context,
        provenance: r.provenance ? (JSON.parse(r.provenance) as SourceRef) : undefined,
        page: {
          title: r.page_title,
          type: r.page_type,
          frontmatter: (frontmatter as Record<string, unknown>) ?? {},
        },
      };
    });
  }

  async traverse(
    slug: string,
    opts?: { depth?: number; direction?: "in" | "out" | "both" },
  ): Promise<TraverseResult> {
    const maxDepth = Math.min(opts?.depth ?? 5, 10);
    const direction = opts?.direction ?? "out";

    // Query focus node
    const focusQuery = await this.pg.query<PageSummaryRow>(
      "SELECT slug, title, type FROM pages WHERE slug = $1",
      [slug],
    );

    if (focusQuery.rows.length === 0) {
      return {
        focus: { slug, title: slug, type: "unknown" },
        nodes: [],
        edges: [],
      };
    }

    const focus = focusQuery.rows[0];
    const visited = new Set<string>();
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let frontier = [slug];
    visited.add(slug);

    for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        const neighbors: Array<{ slug: string; link_type: string }> = [];

        if (direction === "out" || direction === "both") {
          const out = await this.pg.query<LinkTypeRow>(
            `SELECT pt.slug, l.link_type FROM links l JOIN pages pt ON pt.id = l.to_page_id
             WHERE l.from_page_id = (SELECT id FROM pages WHERE slug = $1)`,
            [current],
          );
          neighbors.push(...out.rows.map((r) => ({ slug: r.slug, link_type: r.link_type })));
          edges.push(
            ...out.rows.map((r) => ({
              from_slug: current,
              to_slug: r.slug,
              link_type: r.link_type,
            })),
          );
        }

        if (direction === "in" || direction === "both") {
          const inc = await this.pg.query<LinkTypeRow>(
            `SELECT pf.slug, l.link_type FROM links l JOIN pages pf ON pf.id = l.from_page_id
             WHERE l.to_page_id = (SELECT id FROM pages WHERE slug = $1)`,
            [current],
          );
          neighbors.push(...inc.rows.map((r) => ({ slug: r.slug, link_type: r.link_type })));
          edges.push(
            ...inc.rows.map((r) => ({
              from_slug: r.slug,
              to_slug: current,
              link_type: r.link_type,
            })),
          );
        }

        for (const n of neighbors) {
          if (!visited.has(n.slug)) {
            visited.add(n.slug);
            nextFrontier.push(n.slug);
            const page = await this.pg.query<PageSummaryRow>(
              "SELECT slug, title, type FROM pages WHERE slug = $1",
              [n.slug],
            );
            if (page.rows.length > 0) {
              const p = page.rows[0];
              nodes.push({ slug: p.slug, title: p.title, type: p.type, depth: d });
            }
          }
        }
      }
      frontier = nextFrontier;
    }

    return {
      focus: { slug: focus.slug, title: focus.title, type: focus.type },
      nodes,
      edges,
    };
  }
}

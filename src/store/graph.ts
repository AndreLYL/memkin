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
  provenance?: SourceRef | string | null;
  page_title: string;
  page_type: string;
  page_frontmatter: string | Record<string, unknown>;
}

interface LinkRawRow {
  from_slug: string;
  to_slug: string;
  link_type: string;
  context: string;
  provenance?: SourceRef | string | null;
}

interface InsertRow {
  id: number;
}

function parseProvenance(value: SourceRef | string | null | undefined): SourceRef | undefined {
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
    const result = await this.pg.query<InsertRow>(
      `INSERT INTO links (from_page_id, to_page_id, link_type, context, provenance, source_hash)
       SELECT f.id, t.id, $3, $4, $5, $6
       FROM pages f, pages t
       WHERE f.slug = $1 AND t.slug = $2
       ON CONFLICT (from_page_id, to_page_id, link_type) DO UPDATE SET
         context = EXCLUDED.context,
         provenance = COALESCE(EXCLUDED.provenance, links.provenance),
         source_hash = COALESCE(EXCLUDED.source_hash, links.source_hash)
       RETURNING id`,
      [
        fromSlug,
        toSlug,
        type,
        context ?? "",
        provenance ? JSON.stringify(compactSourceRef(provenance)) : null,
        sourceHash ?? null,
      ],
    );
    if (result.rows.length === 0) {
      const missingSlug = (await this.pageExists(fromSlug)) ? toSlug : fromSlug;
      throw new Error(`Page not found: ${missingSlug}`);
    }
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
    const result = await this.pg.query<LinkRawRow>(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pf.slug = $1`,
      [slug],
    );
    return result.rows.map((row) => ({
      ...row,
      provenance: parseProvenance(row.provenance),
    }));
  }

  async getAllLinksGrouped(): Promise<Map<string, LinkRow[]>> {
    const result = await this.pg.query<LinkRow>(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       ORDER BY pf.slug, pt.slug`,
    );
    const grouped = new Map<string, LinkRow[]>();
    for (const row of result.rows) {
      const list = grouped.get(row.from_slug);
      if (list) list.push(row);
      else grouped.set(row.from_slug, [row]);
    }
    return grouped;
  }

  async getBacklinks(slug: string): Promise<LinkRow[]> {
    const result = await this.pg.query<LinkRawRow>(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pt.slug = $1`,
      [slug],
    );
    return result.rows.map((row) => ({
      ...row,
      provenance: parseProvenance(row.provenance),
    }));
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
        provenance: parseProvenance(r.provenance),
        page: {
          title: r.page_title,
          type: r.page_type,
          frontmatter: (frontmatter as Record<string, unknown>) ?? {},
        },
      };
    });
  }

  async getLinksForSlugs(slugs: string[]): Promise<Map<string, LinkRow[]>> {
    if (slugs.length === 0) return new Map();
    const result = await this.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE pf.slug = ANY($1::text[])`,
      [slugs],
    );
    const map = new Map<string, LinkRow[]>();
    for (const row of result.rows as LinkRow[]) {
      const existing = map.get(row.from_slug) ?? [];
      existing.push(row);
      map.set(row.from_slug, existing);
    }
    return map;
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
        provenance: parseProvenance(r.provenance),
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

  /**
   * Spec 11 §三: descendants of `slug` along a relation `rel`.
   *
   * Children point *up* to their parent via the relation (e.g. a problem-class page
   * carries `[[part_of:category/...]]`, so the edge is child --part_of--> parent).
   * Descendants are therefore found by walking incoming `rel` edges (backlinks).
   * Returns descendants in BFS order, excluding the root; deduped; depth-capped.
   */
  async getSubtree(
    slug: string,
    rel: string,
    depth = 5,
  ): Promise<{ slug: string; title: string }[]> {
    const maxDepth = Math.min(depth, 10);
    const visited = new Set<string>([slug]);
    const out: { slug: string; title: string }[] = [];
    let frontier = [slug];

    for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
      const next: string[] = [];
      for (const current of frontier) {
        const children = await this.pg.query<PageSummaryRow>(
          `SELECT pf.slug, pf.title, pf.type
           FROM links l
           JOIN pages pf ON pf.id = l.from_page_id
           WHERE l.to_page_id = (SELECT id FROM pages WHERE slug = $1)
             AND l.link_type = $2`,
          [current, rel],
        );
        for (const child of children.rows) {
          if (visited.has(child.slug)) continue;
          visited.add(child.slug);
          out.push({ slug: child.slug, title: child.title });
          next.push(child.slug);
        }
      }
      frontier = next;
    }
    return out;
  }

  /**
   * Spec 11 §三: ordered chain starting at `startSlug`, following outgoing `precedes`
   * edges (each page declares `[[precedes:next-slug]]`). Includes the start node first.
   * Cycle-safe; returns [] when the start page does not exist.
   */
  async getOrderedSequence(startSlug: string): Promise<{ slug: string; title: string }[]> {
    const out: { slug: string; title: string }[] = [];
    const visited = new Set<string>();
    let current: string | undefined = startSlug;

    while (current && !visited.has(current)) {
      visited.add(current);
      const page = await this.pg.query<PageSummaryRow>(
        "SELECT slug, title, type FROM pages WHERE slug = $1",
        [current],
      );
      if (page.rows.length === 0) break;
      out.push({ slug: page.rows[0].slug, title: page.rows[0].title });

      const nextRow = await this.pg.query<{ slug: string }>(
        `SELECT pt.slug
         FROM links l
         JOIN pages pt ON pt.id = l.to_page_id
         WHERE l.from_page_id = (SELECT id FROM pages WHERE slug = $1)
           AND l.link_type = 'precedes'
         LIMIT 1`,
        [current],
      );
      current = nextRow.rows[0]?.slug as string | undefined;
    }
    return out;
  }

  private async pageExists(slug: string): Promise<boolean> {
    const result = await this.pg.query("SELECT 1 FROM pages WHERE slug = $1", [slug]);
    return result.rows.length > 0;
  }
}

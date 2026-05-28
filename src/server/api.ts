import { Hono } from "hono";
import type { ChunkStore } from "../store/chunks.js";
import type { Database } from "../store/database.js";
import type { EmbeddingService } from "../store/embedding.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { SearchEngine } from "../store/search.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";

export interface StoreContext {
  db: Database;
  pages: PageStore;
  chunks: ChunkStore;
  search: SearchEngine;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
  embedding: EmbeddingService;
}

function missing(c: { json: (body: unknown, status?: number) => Response }, name: string) {
  return c.json({ error: `Missing required parameter: ${name}` }, 400);
}

export function createApiApp(stores: StoreContext): Hono {
  const app = new Hono();

  app.get("/health", async (c) => {
    const pages = await stores.db.pg.query("SELECT COUNT(*) AS c FROM pages");
    const chunks = await stores.db.pg.query("SELECT COUNT(*) AS c FROM content_chunks");
    return c.json({
      status: "ok",
      pages: Number((pages.rows[0] as Record<string, unknown>).c),
      chunks: Number((chunks.rows[0] as Record<string, unknown>).c),
    });
  });

  app.get("/pages", async (c) => {
    const limitRaw = c.req.query("limit");
    let limit: number | undefined;
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      limit = Number.isFinite(n) && n >= 0 ? n : undefined;
    }

    return c.json(
      await stores.pages.listPages({
        type: c.req.query("type"),
        limit,
        sort: c.req.query("sort"),
        order: c.req.query("order"),
      }),
    );
  });
  app.get("/pages/by-slug", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    const page = await stores.pages.getPage(slug);
    return page ? c.json(page) : c.json({ error: "Not found" }, 404);
  });
  app.put("/pages/by-slug", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    const body = await c.req.json<{ content?: string }>();
    if (!body.content) return missing(c, "content");
    const page = await stores.pages.putPage(slug, body.content);
    await stores.chunks.rechunk(page.id, page.compiled_truth);
    return c.json(page);
  });
  app.delete("/pages/by-slug", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    await stores.pages.deletePage(slug);
    return c.json({ ok: true });
  });

  app.get("/search", async (c) =>
    c.json(
      await stores.search.search(c.req.query("q") ?? "", {
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      }),
    ),
  );
  app.post("/query", async (c) => {
    const body = await c.req.json<{ query?: string; limit?: number }>();
    return c.json(await stores.search.query(body.query ?? "", { limit: body.limit }));
  });

  app.get("/stats", async (c) => {
    const pagesResult = await stores.db.pg.query(
      "SELECT type, COUNT(*)::int AS count FROM pages GROUP BY type",
    );
    const chunksResult = await stores.db.pg.query(
      "SELECT COUNT(*)::int AS total, COUNT(embedded_at)::int AS embedded FROM content_chunks",
    );
    const linksResult = await stores.db.pg.query("SELECT COUNT(*)::int AS c FROM links");

    const pages_by_type: Record<string, number> = {};
    let totalPages = 0;
    for (const row of pagesResult.rows as Array<{ type: string; count: number }>) {
      pages_by_type[row.type] = row.count;
      totalPages += row.count;
    }

    const chunkRow = chunksResult.rows[0] as { total: number; embedded: number };
    const linkRow = linksResult.rows[0] as { c: number };

    return c.json({
      pages: totalPages,
      chunks: chunkRow.total,
      embedded_chunks: chunkRow.embedded,
      links: linkRow.c,
      pages_by_type,
    });
  });

  app.get("/links/all", async (c) => {
    const result = await stores.db.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.context
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id`,
    );
    return c.json(result.rows);
  });

  app.get("/links", async (c) => c.json(await stores.graph.getLinks(c.req.query("slug") ?? "")));
  app.get("/backlinks", async (c) =>
    c.json(await stores.graph.getBacklinks(c.req.query("slug") ?? "")),
  );
  app.post("/links", async (c) => {
    const body = await c.req.json<{ from: string; to: string; type?: string; context?: string }>();
    await stores.graph.addLink(body.from, body.to, body.type ?? "", body.context);
    return c.json({ ok: true });
  });
  app.delete("/links", async (c) => {
    const body = await c.req.json<{ from: string; to: string }>();
    await stores.graph.removeLink(body.from, body.to);
    return c.json({ ok: true });
  });
  app.get("/graph/traverse", async (c) =>
    c.json(
      await stores.graph.traverse(c.req.query("slug") ?? "", {
        depth: c.req.query("depth") ? Number(c.req.query("depth")) : undefined,
        direction: (c.req.query("direction") as "in" | "out" | "both" | undefined) ?? "out",
      }),
    ),
  );

  app.get("/tags", async (c) => c.json(await stores.tags.getTags(c.req.query("slug") ?? "")));
  app.post("/tags", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    const body = await c.req.json<{ tag?: string }>();
    if (!body.tag) return missing(c, "tag");
    await stores.tags.addTag(slug, body.tag);
    return c.json({ ok: true });
  });
  app.delete("/tags", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    const body = await c.req.json<{ tag?: string }>();
    if (!body.tag) return missing(c, "tag");
    await stores.tags.removeTag(slug, body.tag);
    return c.json({ ok: true });
  });

  app.get("/timeline", async (c) =>
    c.json(await stores.timeline.getTimeline(c.req.query("slug") ?? "")),
  );
  app.post("/timeline", async (c) => {
    const slug = c.req.query("slug");
    if (!slug) return missing(c, "slug");
    await stores.timeline.addEntry(slug, await c.req.json());
    return c.json({ ok: true });
  });
  app.get("/chunks", async (c) => c.json(await stores.chunks.getChunks(c.req.query("slug") ?? "")));
  app.post("/embed", async (c) =>
    c.json(
      await stores.embedding.embedStale({
        limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
      }),
    ),
  );

  app.get("/provenance", async (c) => {
    const channel = c.req.query("channel");
    const from = c.req.query("from");
    const to = c.req.query("to");

    const signals: Array<{ type: string; slug?: string; summary: string; source: unknown }> = [];

    // Query pages with source in frontmatter
    const pagesResult = await stores.db.pg.query(
      `SELECT slug, frontmatter FROM pages
       WHERE frontmatter->'source' IS NOT NULL
       ${channel ? "AND frontmatter->'source'->>'channel' = $1" : ""}
       ORDER BY frontmatter->'source'->>'timestamp' DESC`,
      channel ? [channel] : [],
    );
    for (const row of pagesResult.rows as Array<{ slug: string; frontmatter: Record<string, unknown> }>) {
      const src = row.frontmatter.source as Record<string, unknown> | undefined;
      if (!src) continue;
      const ts = src.timestamp as string | undefined;
      if (from && ts && ts < from) continue;
      if (to && ts && ts > to) continue;
      signals.push({
        type: (row.frontmatter.type as string) ?? "page",
        slug: row.slug,
        summary: (row.frontmatter.title as string) ?? row.slug,
        source: src,
      });
    }

    // Query timeline entries with provenance
    const timelineResult = await stores.db.pg.query(
      `SELECT te.summary, te.date, te.provenance, p.slug
       FROM timeline_entries te
       JOIN pages p ON p.id = te.page_id
       WHERE te.provenance IS NOT NULL
       ${channel ? "AND te.provenance->>'channel' = $1" : ""}
       ORDER BY te.date DESC`,
      channel ? [channel] : [],
    );
    for (const row of timelineResult.rows as Array<{ summary: string; date: string; provenance: unknown; slug: string }>) {
      const prov = row.provenance as Record<string, unknown>;
      const ts = prov.timestamp as string | undefined;
      if (from && ts && ts < from) continue;
      if (to && ts && ts > to) continue;
      signals.push({ type: "timeline", slug: row.slug, summary: row.summary, source: prov });
    }

    // Query links with provenance
    const linksResult = await stores.db.pg.query(
      `SELECT pf.slug AS from_slug, pt.slug AS to_slug, l.link_type, l.provenance
       FROM links l
       JOIN pages pf ON pf.id = l.from_page_id
       JOIN pages pt ON pt.id = l.to_page_id
       WHERE l.provenance IS NOT NULL
       ${channel ? "AND l.provenance->>'channel' = $1" : ""}`,
      channel ? [channel] : [],
    );
    for (const row of linksResult.rows as Array<{ from_slug: string; to_slug: string; link_type: string; provenance: unknown }>) {
      const prov = row.provenance as Record<string, unknown>;
      const ts = prov.timestamp as string | undefined;
      if (from && ts && ts < from) continue;
      if (to && ts && ts > to) continue;
      signals.push({
        type: "link",
        summary: `${row.from_slug} → ${row.to_slug} (${row.link_type})`,
        source: prov,
      });
    }

    // Sort by timestamp
    signals.sort((a, b) => {
      const tsA = (a.source as Record<string, unknown>)?.timestamp as string ?? "";
      const tsB = (b.source as Record<string, unknown>)?.timestamp as string ?? "";
      return tsB.localeCompare(tsA);
    });

    return c.json(signals);
  });

  return app;
}

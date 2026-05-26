import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
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

export function createMcpToolHandlers(stores: StoreContext) {
  return {
    query: ({ query, limit }: { query: string; limit?: number }) =>
      stores.search.query(query, { limit }),
    search: ({ query, limit }: { query: string; limit?: number }) =>
      stores.search.search(query, { limit }),
    get_page: ({ slug }: { slug: string }) => stores.pages.getPage(slug),
    put_page: async ({ slug, content }: { slug: string; content: string }) => {
      const page = await stores.pages.putPage(slug, content);
      await stores.chunks.rechunk(page.id, page.compiled_truth);
      return page;
    },
    list_pages: (opts?: { type?: string; limit?: number }) => stores.pages.listPages(opts),
    get_chunks: ({ slug }: { slug: string }) => stores.chunks.getChunks(slug),
    add_link: async ({
      from,
      to,
      type,
      context,
    }: {
      from: string;
      to: string;
      type?: string;
      context?: string;
    }) => {
      await stores.graph.addLink(from, to, type ?? "", context);
      return { ok: true };
    },
    remove_link: async ({ from, to }: { from: string; to: string }) => {
      await stores.graph.removeLink(from, to);
      return { ok: true };
    },
    get_links: ({ slug }: { slug: string }) => stores.graph.getLinks(slug),
    get_backlinks: ({ slug }: { slug: string }) => stores.graph.getBacklinks(slug),
    traverse_graph: ({
      slug,
      depth,
      direction,
    }: {
      slug: string;
      depth?: number;
      direction?: "in" | "out" | "both";
    }) => stores.graph.traverse(slug, { depth, direction }),
    add_tag: async ({ slug, tag }: { slug: string; tag: string }) => {
      await stores.tags.addTag(slug, tag);
      return { ok: true };
    },
    remove_tag: async ({ slug, tag }: { slug: string; tag: string }) => {
      await stores.tags.removeTag(slug, tag);
      return { ok: true };
    },
    get_tags: ({ slug }: { slug: string }) => stores.tags.getTags(slug),
    add_timeline_entry: async (entry: {
      slug: string;
      date: string;
      summary: string;
      detail?: string;
      source?: string;
    }) => {
      await stores.timeline.addEntry(entry.slug, entry);
      return { ok: true };
    },
    get_timeline: ({ slug }: { slug: string }) => stores.timeline.getTimeline(slug),
    get_health: async () => {
      const pages = await stores.db.pg.query("SELECT COUNT(*) AS c FROM pages");
      const chunks = await stores.db.pg.query("SELECT COUNT(*) AS c FROM content_chunks");
      return {
        status: "ok",
        pages: Number((pages.rows[0] as Record<string, unknown>).c),
        chunks: Number((chunks.rows[0] as Record<string, unknown>).c),
      };
    },
  };
}

export function createMcpServer(stores: StoreContext): McpServer {
  const server = new McpServer({ name: "memoark", version: "1.0.0" });
  const tools = createMcpToolHandlers(stores);
  const text = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  });

  server.tool("query", { query: z.string(), limit: z.number().optional() }, async (args) =>
    text(await tools.query(args)),
  );
  server.tool("search", { query: z.string(), limit: z.number().optional() }, async (args) =>
    text(await tools.search(args)),
  );
  server.tool("get_page", { slug: z.string() }, async (args) => text(await tools.get_page(args)));
  server.tool("put_page", { slug: z.string(), content: z.string() }, async (args) =>
    text(await tools.put_page(args)),
  );
  server.tool(
    "list_pages",
    { type: z.string().optional(), limit: z.number().optional() },
    async (args) => text(await tools.list_pages(args)),
  );
  server.tool("get_chunks", { slug: z.string() }, async (args) =>
    text(await tools.get_chunks(args)),
  );
  server.tool(
    "add_link",
    {
      from: z.string(),
      to: z.string(),
      type: z.string().optional(),
      context: z.string().optional(),
    },
    async (args) => text(await tools.add_link(args)),
  );
  server.tool("remove_link", { from: z.string(), to: z.string() }, async (args) =>
    text(await tools.remove_link(args)),
  );
  server.tool("get_links", { slug: z.string() }, async (args) => text(await tools.get_links(args)));
  server.tool("get_backlinks", { slug: z.string() }, async (args) =>
    text(await tools.get_backlinks(args)),
  );
  server.tool(
    "traverse_graph",
    {
      slug: z.string(),
      depth: z.number().optional(),
      direction: z.enum(["in", "out", "both"]).optional(),
    },
    async (args) => text(await tools.traverse_graph(args)),
  );
  server.tool("add_tag", { slug: z.string(), tag: z.string() }, async (args) =>
    text(await tools.add_tag(args)),
  );
  server.tool("remove_tag", { slug: z.string(), tag: z.string() }, async (args) =>
    text(await tools.remove_tag(args)),
  );
  server.tool("get_tags", { slug: z.string() }, async (args) => text(await tools.get_tags(args)));
  server.tool(
    "add_timeline_entry",
    {
      slug: z.string(),
      date: z.string(),
      summary: z.string(),
      detail: z.string().optional(),
      source: z.string().optional(),
    },
    async (args) => text(await tools.add_timeline_entry(args)),
  );
  server.tool("get_timeline", { slug: z.string() }, async (args) =>
    text(await tools.get_timeline(args)),
  );
  server.tool("get_health", {}, async () => text(await tools.get_health()));

  return server;
}

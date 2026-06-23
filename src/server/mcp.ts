import { createHash } from "node:crypto";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// Static JSON import: bun's bundler inlines this into the --compile binary
// (a runtime require("../../package.json") is not resolvable inside $bunfs).
import pkg from "../../package.json";
import { type IngestDeps, ingestFeishuDoc } from "../collectors/feishu/docs/ingest.js";
import {
  type HandleKind,
  type HandleStrength,
  PersonIdentityStore,
} from "../core/person-identity.js";
import { SourceRefSchema } from "../core/schemas.js";
import type { MemoryFilter, SourceRef } from "../core/types.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import type { ChunkStore } from "../store/chunks.js";
import type { Database } from "../store/database.js";
import type { EmbeddingService } from "../store/embedding.js";
import type { GraphStore } from "../store/graph.js";
import type { Page, PageStore } from "../store/pages.js";
import { PersonBehaviorStore } from "../store/person-behavior.js";
import type { SearchEngine } from "../store/search.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";
import type { SynthScope } from "../synth/index.js";
import { synthesize } from "../synth/index.js";
import type { StoreContext as SynthStoreContext } from "./api.js";
import { getSessionContext } from "./context.js";
import { getEntityProfile, listSignalsByEntity } from "./entity.js";

const packageVersion: string = pkg.version;

const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const LIST_DEFAULT_LIMIT = 20;
const LIST_MAX_LIMIT = 100;
const GRAPH_DEFAULT_DEPTH = 2;
const GRAPH_MAX_DEPTH = 5;
const MCP_CONTRACT_VERSION = "2026-06-04";

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

export interface McpServerOptions {
  exposeLegacyTools?: boolean;
  readOnly?: boolean;
  version?: string;
  /** LLM provider for synthesis tools (synthesize/recall). When omitted, synthesize/recall return a structured INVALID_ARGUMENT error. */
  provider?: LLMProvider;
  /** Model id recorded in synthesis result meta. */
  synthModel?: string;
}

interface ToolError {
  error: {
    code: "NOT_FOUND" | "INVALID_ARGUMENT" | "INVALID_DATE" | "WRITE_FAILED" | "INTERNAL_ERROR";
    message: string;
    suggestion?: string;
  };
}

type ToolPayload = unknown;

function structuredError(
  code: ToolError["error"]["code"],
  message: string,
  suggestion?: string,
): ToolError {
  return { error: { code, message, suggestion } };
}

function isToolError(value: unknown): value is ToolError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "error" in value &&
      typeof (value as { error?: unknown }).error === "object",
  );
}

function clampLimit(limit: number | undefined, max: number, defaultLimit: number): number {
  if (!Number.isFinite(limit) || (limit ?? 0) <= 0) return defaultLimit;
  return Math.min(Math.floor(limit as number), max);
}

function clampDepth(depth: number | undefined): number {
  if (!Number.isFinite(depth) || (depth ?? 0) <= 0) return GRAPH_DEFAULT_DEPTH;
  return Math.min(Math.floor(depth as number), GRAPH_MAX_DEPTH);
}

function isValidDate(value: string | undefined): boolean {
  if (!value) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

function validateDates(filter: Pick<MemoryFilter, "from" | "to">): ToolError | undefined {
  if (!isValidDate(filter.from) || !isValidDate(filter.to)) {
    return structuredError(
      "INVALID_DATE",
      "from/to must be ISO dates or datetimes",
      "Retry with values such as `2026-06-04` or `2026-06-04T10:00:00.000Z`.",
    );
  }
  return undefined;
}

function validateTimelineDate(date: string): ToolError | undefined {
  if (isValidDate(date)) return undefined;
  return structuredError(
    "INVALID_DATE",
    "date must be an ISO date or datetime",
    "Retry with a value such as `2026-06-04` or `2026-06-04T10:00:00.000Z`.",
  );
}

function normalizeSearchFilter(args: MemoryFilter): MemoryFilter | ToolError {
  const dateError = validateDates(args);
  if (dateError) return dateError;
  return {
    ...args,
    limit: clampLimit(args.limit, SEARCH_MAX_LIMIT, SEARCH_DEFAULT_LIMIT),
  };
}

function normalizeListFilter(args: MemoryFilter): MemoryFilter | ToolError {
  const dateError = validateDates(args);
  if (dateError) return dateError;
  return {
    ...args,
    limit: clampLimit(args.limit, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT),
  };
}

function validSlug(slug: string): boolean {
  return Boolean(slug && slug.trim() === slug && !/\s/.test(slug) && !slug.includes(".."));
}

function invalidSlugError(): ToolError {
  return structuredError(
    "INVALID_ARGUMENT",
    "slug must be a non-empty stable page identifier",
    "Use a slug such as `projects/memoark` or `people/alice`.",
  );
}

function notFound(slug: string): ToolError {
  return structuredError(
    "NOT_FOUND",
    `Page not found: ${slug}`,
    "Call `query` or `search` first to find the correct page slug.",
  );
}

function normalizeOptionalSourceRef(
  provenance: SourceRef | Record<string, unknown> | undefined,
): SourceRef | undefined | ToolError {
  if (!provenance) return undefined;
  const parsed = SourceRefSchema.safeParse(provenance);
  if (parsed.success) return parsed.data;
  return structuredError(
    "INVALID_ARGUMENT",
    "provenance must be a valid SourceRef object",
    "Provide at least platform and channel; timestamp, raw_hash, and quote are filled with safe defaults when omitted.",
  );
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function ensurePage(stores: StoreContext, slug: string): Promise<Page | ToolError> {
  if (!validSlug(slug)) return invalidSlugError();
  const page = await stores.pages.getPage(slug);
  return page ?? notFound(slug);
}

const memoryFilterInputSchema = {
  platform: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe("Limit results to one or more source platforms, for example `wechat` or `feishu`."),
  source_type: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      "Limit results to one or more source types, for example `dm`, `group`, or `document`.",
    ),
  channel: z
    .string()
    .optional()
    .describe("Limit results to a stable source channel id, for example `dm/wechat/wxid_123`."),
  channel_name: z
    .string()
    .optional()
    .describe("Limit results to a human-readable channel name, for example `产品评审群`."),
  participant: z
    .string()
    .optional()
    .describe("Limit results to memories involving this exact participant display name."),
  from: z.string().optional().describe("Inclusive lower time bound as an ISO date or datetime."),
  to: z.string().optional().describe("Inclusive upper time bound as an ISO date or datetime."),
  type: z
    .array(z.string())
    .optional()
    .describe("Limit results to page types such as `decision`, `task`, or `person`."),
  exclude_types: z.array(z.string()).optional().describe("Exclude these page types from results."),
  limit: z
    .number()
    .optional()
    .describe("Maximum number of results. Search tools default to 20 and clamp to 50."),
};

function description(name: string, body: string): string {
  return `## ${name}

${body}`;
}

function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function decodeSlug(value: unknown): string {
  return decodeURIComponent(String(value ?? ""));
}

export function createMcpToolHandlers(stores: StoreContext, options: McpServerOptions = {}) {
  const identity = new PersonIdentityStore(
    stores.db.pg,
    { pages: stores.pages },
    { behavior: new PersonBehaviorStore(stores.db.pg) },
  );
  return {
    query: async (args: MemoryFilter & { query: string }) => {
      const filter = normalizeSearchFilter(args);
      if (isToolError(filter)) return filter;
      return stores.search.query(args.query, filter);
    },
    search: async (args: MemoryFilter & { query: string }) => {
      const filter = normalizeSearchFilter(args);
      if (isToolError(filter)) return filter;
      return stores.search.search(args.query, filter);
    },
    get_page_context: async ({
      slug,
      include,
      limit,
    }: {
      slug: string;
      include?: { links?: boolean; backlinks?: boolean; timeline?: boolean; chunks?: boolean };
      limit?: number;
    }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;

      const boundedLimit = clampLimit(limit, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT);
      const includeLinks = include?.links ?? true;
      const includeBacklinks = include?.backlinks ?? true;
      const includeTimeline = include?.timeline ?? true;
      const includeChunks = include?.chunks ?? false;

      return {
        page,
        tags: await stores.tags.getTags(slug),
        links: includeLinks
          ? (await stores.graph.getLinksEnriched(slug)).slice(0, boundedLimit)
          : [],
        backlinks: includeBacklinks
          ? (await stores.graph.getBacklinksEnriched(slug)).slice(0, boundedLimit)
          : [],
        timeline: includeTimeline
          ? (await stores.timeline.getTimeline(slug)).slice(0, boundedLimit)
          : [],
        chunks: includeChunks
          ? (await stores.chunks.getChunks(slug)).slice(0, boundedLimit)
          : undefined,
        provenance:
          (page.frontmatter.source as SourceRef | undefined) ??
          (page.frontmatter.first_seen as SourceRef | undefined),
      };
    },
    timeline_feed: async (args: MemoryFilter & { query?: string }) => {
      const filter = normalizeListFilter(args);
      if (isToolError(filter)) return filter;
      return stores.timeline.feed({ ...filter, query: args.query });
    },
    explore_graph: async ({
      slug,
      depth,
      direction,
    }: {
      slug: string;
      depth?: number;
      direction?: "in" | "out" | "both";
    }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return stores.graph.traverse(slug, {
        depth: clampDepth(depth),
        direction: direction ?? "both",
      });
    },
    get_page: ({ slug }: { slug: string }) => ensurePage(stores, slug),
    put_page: async ({ slug, content }: { slug: string; content: string }) => {
      if (!validSlug(slug)) return invalidSlugError();
      if (!content.trim()) {
        return structuredError(
          "INVALID_ARGUMENT",
          "content must be non-empty markdown",
          "Provide page content, usually with YAML frontmatter and a markdown body.",
        );
      }

      const contentHash = hashContent(content);
      const existing = await stores.pages.getPage(slug);
      if (existing?.content_hash === contentHash) {
        return {
          ok: true,
          slug,
          changed: false,
          content_hash: contentHash,
          previous_hash: existing.content_hash,
          updated_at: existing.updated_at,
        };
      }

      const page = await stores.pages.putPage(slug, content);
      await stores.chunks.rechunk(page.id, page.compiled_truth);
      return {
        ok: true,
        slug,
        changed: true,
        content_hash: page.content_hash,
        previous_hash: existing?.content_hash,
        updated_at: page.updated_at,
      };
    },
    list_pages: (opts?: { type?: string; limit?: number }) =>
      stores.pages.listPages({
        ...opts,
        limit: clampLimit(opts?.limit, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT),
      }),
    get_chunks: async ({ slug, limit }: { slug: string; limit?: number }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return (await stores.chunks.getChunks(slug)).slice(
        0,
        clampLimit(limit, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT),
      );
    },
    manage_links: async ({
      action,
      from,
      to,
      type,
      context,
      provenance,
    }: {
      action: "add" | "remove";
      from: string;
      to: string;
      type?: string;
      context?: string;
      provenance?: SourceRef | Record<string, unknown>;
    }) => {
      const fromPage = await ensurePage(stores, from);
      if (isToolError(fromPage)) return fromPage;
      const toPage = await ensurePage(stores, to);
      if (isToolError(toPage)) return toPage;

      if (action === "add") {
        const sourceRef = normalizeOptionalSourceRef(provenance);
        if (isToolError(sourceRef)) return sourceRef;
        await stores.graph.addLink(
          from,
          to,
          type ?? "mentions",
          context,
          sourceRef,
          sourceRef?.raw_hash,
        );
      } else {
        await stores.graph.removeLink(from, to);
      }

      return { ok: true, action, from, to };
    },
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
    }) =>
      createMcpToolHandlers(stores, options).manage_links({
        action: "add",
        from,
        to,
        type,
        context,
      }),
    remove_link: async ({ from, to }: { from: string; to: string }) =>
      createMcpToolHandlers(stores, options).manage_links({ action: "remove", from, to }),
    get_links: async ({ slug, limit }: { slug: string; limit?: number }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return (await stores.graph.getLinks(slug)).slice(0, clampLimit(limit, 200, 50));
    },
    get_backlinks: async ({ slug, limit }: { slug: string; limit?: number }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return (await stores.graph.getBacklinks(slug)).slice(0, clampLimit(limit, 200, 50));
    },
    traverse_graph: ({
      slug,
      depth,
      direction,
    }: {
      slug: string;
      depth?: number;
      direction?: "in" | "out" | "both";
    }) => stores.graph.traverse(slug, { depth: clampDepth(depth), direction }),
    manage_tags: async ({
      action,
      slug,
      tags,
    }: {
      action: "add" | "remove";
      slug: string;
      tags: string[];
    }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      if (!tags.length) {
        return structuredError(
          "INVALID_ARGUMENT",
          "tags must contain at least one tag",
          "Retry with one or more short tag strings.",
        );
      }

      for (const tag of tags) {
        if (action === "add") {
          await stores.tags.addTag(slug, tag);
        } else {
          await stores.tags.removeTag(slug, tag);
        }
      }
      return { ok: true, action, slug, tags };
    },
    add_tag: async ({ slug, tag }: { slug: string; tag: string }) =>
      createMcpToolHandlers(stores, options).manage_tags({ action: "add", slug, tags: [tag] }),
    remove_tag: async ({ slug, tag }: { slug: string; tag: string }) =>
      createMcpToolHandlers(stores, options).manage_tags({ action: "remove", slug, tags: [tag] }),
    get_tags: async ({ slug }: { slug: string }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return stores.tags.getTags(slug);
    },
    add_timeline_entry: async (entry: {
      slug: string;
      date: string;
      summary: string;
      detail?: string;
      source?: string;
      provenance?: SourceRef | Record<string, unknown>;
    }) => {
      const dateError = validateTimelineDate(entry.date);
      if (dateError) return dateError;
      const page = await ensurePage(stores, entry.slug);
      if (isToolError(page)) return page;
      const provenance = normalizeOptionalSourceRef(entry.provenance);
      if (isToolError(provenance)) return provenance;
      await stores.timeline.addEntry(entry.slug, {
        ...entry,
        provenance,
      });
      return { ok: true, slug: entry.slug, date: entry.date, summary: entry.summary };
    },
    get_timeline: async ({ slug, limit }: { slug: string; limit?: number }) => {
      const page = await ensurePage(stores, slug);
      if (isToolError(page)) return page;
      return (await stores.timeline.getTimeline(slug)).slice(
        0,
        clampLimit(limit, LIST_MAX_LIMIT, LIST_DEFAULT_LIMIT),
      );
    },
    get_health: async () => {
      const pages = await stores.db.pg.query("SELECT COUNT(*) AS c FROM pages");
      const chunks = await stores.db.pg.query("SELECT COUNT(*) AS c FROM content_chunks");
      return {
        status: "ok",
        pages: Number((pages.rows[0] as Record<string, unknown>).c),
        chunks: Number((chunks.rows[0] as Record<string, unknown>).c),
        mcp_version: options.version ?? packageVersion,
        mcp_contract_version: MCP_CONTRACT_VERSION,
        legacy_tools_exposed: options.exposeLegacyTools ?? false,
        read_only: options.readOnly ?? false,
        capabilities: {
          tools: true,
          resources: true,
          prompts: true,
          structured_output: true,
          streamable_http: true,
        },
      };
    },
    get_session_context: ({ days }: { days?: number }) => getSessionContext(stores, days ?? 7),
    list_signals_by_entity: ({
      entity_slug,
      signal_types,
      limit,
    }: {
      entity_slug: string;
      signal_types?: string[];
      limit?: number;
    }) => listSignalsByEntity(stores, entity_slug, signal_types, limit ?? 20),

    get_entity_profile: ({ entity_slug }: { entity_slug: string }) =>
      getEntityProfile(stores, entity_slug),

    // ── Person identity (Layer 1: aliases / merge / rename) ──────────────
    link_person_alias: async ({
      canonical_slug,
      kind,
      value,
      strength,
    }: {
      canonical_slug: string;
      kind: HandleKind;
      value: string;
      strength?: HandleStrength;
    }) => {
      await identity.addAlias(canonical_slug, kind, value, strength);
      return { ok: true, canonical_slug, handles: await identity.listHandles(canonical_slug) };
    },
    list_person_handles: ({ canonical_slug }: { canonical_slug: string }) =>
      identity.listHandles(canonical_slug),
    remove_person_alias: async ({ kind, value }: { kind: HandleKind; value: string }) => {
      await identity.removeHandle(kind, value);
      return { ok: true };
    },
    merge_persons: async ({ from, into }: { from: string; into: string }) => {
      await identity.merge(from, into);
      return { ok: true, merged: from, into, handles: await identity.listHandles(into) };
    },
    recanonicalize_person: async ({ from, to }: { from: string; to: string }) => {
      await identity.recanonicalize(from, to);
      return { ok: true, from, to, handles: await identity.listHandles(to) };
    },

    // ── Synthesis (Spec 7): synthesize + recall ──────────────────────────
    synthesize: async ({ intent, scope }: { intent: string; scope?: SynthScope }) => {
      if (!options.provider) {
        return structuredError(
          "INVALID_ARGUMENT",
          "No LLM provider configured for synthesis.",
          "Configure an LLM provider (llm config) to use synthesize/recall.",
        );
      }
      try {
        return await synthesize(intent, scope ?? {}, {
          stores: stores as unknown as SynthStoreContext,
          provider: options.provider,
          model: options.synthModel,
        });
      } catch (e) {
        return structuredError(
          "INTERNAL_ERROR",
          `synthesis failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    recall: async ({
      entity,
      query,
      time,
    }: {
      entity?: string;
      query?: string;
      time?: { from: string; to: string };
    }) => {
      if (!options.provider) {
        return structuredError(
          "INVALID_ARGUMENT",
          "No LLM provider configured for synthesis.",
          "Configure an LLM provider (llm config) to use synthesize/recall.",
        );
      }
      const scope: SynthScope = { entity, query, time, limit: 30 };
      try {
        return await synthesize("recall", scope, {
          stores: stores as unknown as SynthStoreContext,
          provider: options.provider,
          model: options.synthModel,
        });
      } catch (e) {
        return structuredError(
          "INTERNAL_ERROR",
          `synthesis failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    // ── Spec 8: prep_for_person — communication strategy for a person ─────
    prep_for_person: async ({ person, goal }: { person: string; goal?: string }) => {
      const provider =
        options.provider ??
        createMockProvider(new Map([["", "(synthesis unavailable: no LLM provider configured)"]]));
      return synthesize(
        "person_strategy",
        { entity: person },
        {
          stores: stores as unknown as SynthStoreContext,
          provider,
          model: options.synthModel,
        },
        { extra: goal ? { goal } : undefined },
      );
    },
  };
}

function text(value: ToolPayload) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    isError: isToolError(value) || undefined,
  };
}

function structuredText(value: ToolPayload, structuredContent: Record<string, unknown>) {
  if (isToolError(value)) return text(value);
  return {
    ...text(value),
    structuredContent,
  };
}

const outputSchemas = {
  results: {
    results: z.array(z.record(z.unknown())).describe("Ranked memory results."),
  },
  timelineFeed: {
    entries: z.array(z.record(z.unknown())).describe("Timeline feed entries."),
  },
  pageContext: {
    page: z.record(z.unknown()).describe("Memoark page."),
    tags: z.array(z.string()).describe("Tags on the page."),
    links: z.array(z.record(z.unknown())).describe("Outgoing links."),
    backlinks: z.array(z.record(z.unknown())).describe("Incoming links."),
    timeline: z.array(z.record(z.unknown())).describe("Page timeline entries."),
    chunks: z.array(z.record(z.unknown())).optional().describe("Optional page chunks."),
    provenance: z.record(z.unknown()).optional().describe("Compact source provenance."),
  },
  health: {
    status: z.string().describe("Health status."),
    pages: z.number().describe("Stored page count."),
    chunks: z.number().describe("Stored chunk count."),
    mcp_version: z.string().describe("Memoark package version exposed by MCP."),
    mcp_contract_version: z.string().describe("MCP contract version."),
    legacy_tools_exposed: z.boolean().describe("Whether legacy MCP tools are exposed."),
    read_only: z.boolean().describe("Whether this server hides write tools."),
    capabilities: z.record(z.unknown()).describe("Capability flags."),
  },
  exploreGraph: {
    focus: z.record(z.unknown()).describe("Focus page."),
    nodes: z.array(z.record(z.unknown())).describe("Graph nodes."),
    edges: z.array(z.record(z.unknown())).describe("Graph edges."),
  },
  putPage: {
    ok: z.boolean().describe("Whether the write succeeded."),
    slug: z.string().describe("Page slug."),
    changed: z.boolean().describe("Whether content changed."),
    content_hash: z.string().describe("Current content hash."),
    previous_hash: z.string().optional().describe("Previous content hash, if any."),
    updated_at: z.string().describe("Page update timestamp."),
  },
  timelineWrite: {
    ok: z.boolean().describe("Whether the write succeeded."),
    slug: z.string().describe("Page slug."),
    date: z.string().describe("Timeline event date."),
    summary: z.string().describe("Timeline event summary."),
  },
  linkWrite: {
    ok: z.boolean().describe("Whether the write succeeded."),
    action: z.string().describe("Performed link action."),
    from: z.string().describe("Source slug."),
    to: z.string().describe("Target slug."),
  },
  tagWrite: {
    ok: z.boolean().describe("Whether the write succeeded."),
    action: z.string().describe("Performed tag action."),
    slug: z.string().describe("Page slug."),
    tags: z.array(z.string()).describe("Managed tags."),
  },
};

function registerPreferredTools(
  server: McpServer,
  tools: ReturnType<typeof createMcpToolHandlers>,
  options: McpServerOptions,
) {
  server.registerTool(
    "query",
    {
      title: "Semantic Memory Query",
      description: description(
        "query",
        "Semantic search across Memoark memory.\n\nWhen to use: fuzzy, conceptual recall across people, projects, decisions, tasks, and prior work.\nWhen NOT to use: exact keyword matching; use `search` instead. Do not look for source-specific tools; use filters.\nReturns: ranked results with slug, title, type, snippet, score, and provenance.\nOn error: broaden filters or retry with fewer constraints.",
      ),
      inputSchema: {
        query: z.string().describe("Natural language search query, for example `上周部署方案`."),
        ...memoryFilterInputSchema,
      },
      outputSchema: outputSchemas.results,
    },
    async (args) => {
      const value = await tools.query(args);
      return structuredText(value, { results: Array.isArray(value) ? value : [] });
    },
  );

  server.registerTool(
    "search",
    {
      title: "Exact Memory Search",
      description: description(
        "search",
        "Keyword search across Memoark memory.\n\nWhen to use: exact words, identifiers, tokens, page titles, or known phrases.\nWhen NOT to use: fuzzy conceptual recall; use `query` instead.\nReturns: ranked keyword matches with provenance.\nOn error: simplify the query or relax filters.",
      ),
      inputSchema: {
        query: z.string().describe("Exact keyword query, for example `JWT token`."),
        ...memoryFilterInputSchema,
      },
      outputSchema: outputSchemas.results,
    },
    async (args) => {
      const value = await tools.search(args);
      return structuredText(value, { results: Array.isArray(value) ? value : [] });
    },
  );

  server.registerTool(
    "get_page_context",
    {
      title: "Get Page Context",
      description: description(
        "get_page_context",
        "Read a page plus nearby memory context.\n\nWhen to use: after finding a slug and needing page, tags, links, backlinks, timeline, or chunks in one call.\nWhen NOT to use: broad recall without a slug; use `query` or `search` first.\nReturns: page, tags, limited related context, and provenance.\nOn error: if the slug is missing, search for the correct slug first.",
      ),
      inputSchema: {
        slug: z.string().describe("Page slug to read, for example `projects/memoark`."),
        include: z
          .object({
            links: z.boolean().optional().describe("Include outgoing links."),
            backlinks: z.boolean().optional().describe("Include incoming links."),
            timeline: z.boolean().optional().describe("Include page timeline entries."),
            chunks: z.boolean().optional().describe("Include page content chunks."),
          })
          .optional()
          .describe("Optional context sections to include."),
        limit: z
          .number()
          .optional()
          .describe("Maximum related items per section, default 20, max 100."),
      },
      outputSchema: outputSchemas.pageContext,
    },
    async (args) => {
      const value = await tools.get_page_context(args);
      return structuredText(value, value as Record<string, unknown>);
    },
  );

  server.registerTool(
    "timeline_feed",
    {
      title: "Timeline Feed",
      description: description(
        "timeline_feed",
        "Read global timeline memories.\n\nWhen to use: recent activity reviews, date-bounded recall, and source-filtered timeline scans.\nWhen NOT to use: page-specific context; use `get_page_context`.\nReturns: timeline entries with slug, title, type, summary, time, snippet, and provenance.\nOn error: fix invalid date filters and retry.",
      ),
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Optional keyword filter for timeline summary/detail/title."),
        ...memoryFilterInputSchema,
      },
      outputSchema: outputSchemas.timelineFeed,
    },
    async (args) => {
      const value = await tools.timeline_feed(args);
      return structuredText(value, { entries: Array.isArray(value) ? value : [] });
    },
  );

  server.registerTool(
    "explore_graph",
    {
      title: "Explore Memory Graph",
      description: description(
        "explore_graph",
        "Explore graph relationships around a page.\n\nWhen to use: understand dependencies, mentions, collaborators, and nearby entities.\nWhen NOT to use: raw page content; use `get_page_context`.\nReturns: focus node, graph nodes, and edges with bounded depth.\nOn error: search for the correct slug first.",
      ),
      inputSchema: {
        slug: z.string().describe("Focus page slug."),
        depth: z.number().optional().describe("Traversal depth, default 2, max 5."),
        direction: z.enum(["in", "out", "both"]).optional().describe("Traversal direction."),
      },
      outputSchema: outputSchemas.exploreGraph,
    },
    async (args) => {
      const value = await tools.explore_graph(args);
      return structuredText(value, value as unknown as Record<string, unknown>);
    },
  );

  server.registerTool(
    "synthesize",
    {
      title: "Synthesize Memory",
      description: description(
        "synthesize",
        "Synthesize a cited, gap-aware answer from memory using an intent template.\n\nWhen to use: you want a composed answer (not raw snippets) about an entity, time window, or query.\nWhen NOT to use: raw ranked snippets; use `query`/`search`.\nReturns: answer with inline [n] citations, citations[], and gaps[] (stale / missing).\nOn error: ensure the intent is registered and the scope is non-empty.",
      ),
      inputSchema: {
        intent: z.string().describe("Registered synthesis intent, for example `recall`."),
        scope: z
          .object({
            entity: z.string().optional().describe("Anchor entity slug, e.g. `people/zhang-san`."),
            query: z.string().optional().describe("Free-text semantic query."),
            time: z
              .object({ from: z.string(), to: z.string() })
              .optional()
              .describe("Time window (ISO dates)."),
            types: z.array(z.string()).optional().describe("Limit to signal types."),
            channels: z.array(z.string()).optional().describe("Limit to source channels."),
            limit: z.number().optional().describe("Candidate cap, default 30."),
          })
          .partial()
          .optional()
          .describe("Retrieval scope (entity / time / query)."),
      },
    },
    async (args) => text(await tools.synthesize(args)),
  );

  server.registerTool(
    "recall",
    {
      title: "Recall Memory (Synthesized)",
      description: description(
        "recall",
        "Recall a synthesized, cited summary about an entity, query, or time window.\n\nWhen to use: a quick composed recall with citations and gap flags.\nWhen NOT to use: raw snippets; use `query`/`search`.\nReturns: a SynthesisResult (answer + citations + gaps).\nOn error: provide at least one of entity, query, or time.",
      ),
      inputSchema: {
        entity: z.string().optional().describe("Anchor entity slug, e.g. `people/zhang-san`."),
        query: z.string().optional().describe("Free-text semantic query."),
        time: z
          .object({ from: z.string(), to: z.string() })
          .optional()
          .describe("Time window (ISO dates)."),
      },
    },
    async (args) => text(await tools.recall(args)),
  );

  server.registerTool(
    "prep_for_person",
    {
      title: "Prep for Person (Communication Strategy)",
      description: description(
        "prep_for_person",
        "Prepare goal-conditioned communication strategy for a person from their passively-inferred communication profile.\n\nWhen to use: before talking to someone — get evidence-cited, ethical suggestions on how to communicate with them, optionally toward a specific goal.\nWhen NOT to use: raw facts about the person; use `get_entity_profile`/`query`.\nReturns: a SynthesisResult (cited suggestions + gaps). Suggestions only — never manipulation. Profiling is passive and local; the four-color shell is a popular mapping, not a clinical diagnosis.\nOn error: ensure the person page slug exists.",
      ),
      inputSchema: {
        person: z.string().describe("Person page slug, e.g. `people/zhang-san`."),
        goal: z.string().optional().describe("Optional goal for this conversation."),
      },
    },
    async (args) => text(await tools.prep_for_person(args)),
  );

  if (!options.readOnly) {
    registerWriteTools(server, tools);
  }

  server.registerTool(
    "get_health",
    {
      title: "Get Health",
      description: description(
        "get_health",
        "Return Memoark MCP health and capability metadata.\n\nWhen to use: diagnose database counts, MCP version, and legacy tool exposure.\nWhen NOT to use: retrieve memory content; use read tools.\nReturns: status, page/chunk counts, MCP version, and legacy setting.\nOn error: inspect server logs.",
      ),
      inputSchema: {},
      outputSchema: outputSchemas.health,
    },
    async () => {
      const value = await tools.get_health();
      return structuredText(value, value as Record<string, unknown>);
    },
  );
}

async function safeWrite<T>(fn: () => Promise<T>): Promise<T | ToolError> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return structuredError(
      "WRITE_FAILED",
      `Write operation failed: ${message}`,
      "Check the slug exists and input is valid, then retry.",
    );
  }
}

function registerWriteTools(server: McpServer, tools: ReturnType<typeof createMcpToolHandlers>) {
  server.registerTool(
    "put_page",
    {
      title: "Put Page",
      description: description(
        "put_page",
        "Create or update a Memoark page idempotently.\n\nWhen to use: write a durable memory page.\nWhen NOT to use: append a dated event; use `add_timeline_entry`.\nReturns: ok, slug, changed flag, content hash, previous hash, and updated_at.\nOn error: fix slug or non-empty content.",
      ),
      inputSchema: {
        slug: z.string().describe("Stable page slug, for example `decisions/use-pglite`."),
        content: z.string().describe("Full markdown content, optionally with YAML frontmatter."),
      },
      outputSchema: outputSchemas.putPage,
    },
    async (args) => {
      const value = await safeWrite(() => tools.put_page(args));
      return structuredText(value, value as Record<string, unknown>);
    },
  );

  server.registerTool(
    "add_timeline_entry",
    {
      title: "Add Timeline Entry",
      description: description(
        "add_timeline_entry",
        "Append a dated memory event to an existing page.\n\nWhen to use: record project progress, decisions, or notable events.\nWhen NOT to use: full page replacement; use `put_page`.\nReturns: ok plus slug/date/summary.\nOn error: fix invalid date or find the correct page slug.",
      ),
      inputSchema: {
        slug: z.string().describe("Existing page slug."),
        date: z.string().describe("ISO date or datetime for the event."),
        summary: z.string().describe("Short event summary."),
        detail: z.string().optional().describe("Optional event detail."),
        source: z.string().optional().describe("Legacy display source string."),
        provenance: z
          .record(z.unknown())
          .optional()
          .describe("Optional SourceRef provenance object."),
      },
      outputSchema: outputSchemas.timelineWrite,
    },
    async (args) => {
      const value = await safeWrite(() => tools.add_timeline_entry(args));
      return structuredText(value, value as Record<string, unknown>);
    },
  );

  server.registerTool(
    "manage_links",
    {
      title: "Manage Links",
      description: description(
        "manage_links",
        "Add or remove graph links between pages.\n\nWhen to use: maintain relationships such as mentions, depends_on, or works_on.\nWhen NOT to use: tagging; use `manage_tags`.\nReturns: ok plus action/from/to.\nOn error: search for missing page slugs before retrying.",
      ),
      inputSchema: {
        action: z.enum(["add", "remove"]).describe("Whether to add or remove the link."),
        from: z.string().describe("Source page slug."),
        to: z.string().describe("Target page slug."),
        type: z.string().optional().describe("Relationship type, default `mentions`."),
        context: z.string().optional().describe("Short relationship context."),
        provenance: z
          .record(z.unknown())
          .optional()
          .describe("Optional SourceRef provenance object."),
      },
      outputSchema: outputSchemas.linkWrite,
    },
    async (args) => {
      const value = await safeWrite(() => tools.manage_links(args));
      return structuredText(value, value as Record<string, unknown>);
    },
  );

  server.registerTool(
    "manage_tags",
    {
      title: "Manage Tags",
      description: description(
        "manage_tags",
        "Add or remove tags on a page.\n\nWhen to use: classify memory pages with stable tags.\nWhen NOT to use: graph relationships; use `manage_links`.\nReturns: ok plus action/slug/tags.\nOn error: search for the page slug or provide at least one tag.",
      ),
      inputSchema: {
        action: z.enum(["add", "remove"]).describe("Whether to add or remove tags."),
        slug: z.string().describe("Existing page slug."),
        tags: z.array(z.string()).describe("One or more tag names."),
      },
      outputSchema: outputSchemas.tagWrite,
    },
    async (args) => {
      const value = await safeWrite(() => tools.manage_tags(args));
      return structuredText(value, value as Record<string, unknown>);
    },
  );
}

function registerLegacyTools(
  server: McpServer,
  tools: ReturnType<typeof createMcpToolHandlers>,
  options: McpServerOptions,
) {
  const legacy = "Legacy/debug/internal use only. Prefer high-intent memory tools by default.";

  server.registerTool(
    "get_page",
    {
      title: "Legacy Get Page",
      description: `${legacy} Read a page by slug.`,
      inputSchema: { slug: z.string().describe("Page slug.") },
    },
    async (args) => text(await tools.get_page(args)),
  );
  server.registerTool(
    "list_pages",
    {
      title: "Legacy List Pages",
      description: `${legacy} List pages with optional type and limit.`,
      inputSchema: {
        type: z.string().optional().describe("Optional page type."),
        limit: z.number().optional().describe("Maximum pages, default 20, max 100."),
      },
    },
    async (args) => text(await tools.list_pages(args)),
  );
  server.registerTool(
    "get_chunks",
    {
      title: "Legacy Get Chunks",
      description: `${legacy} Read page chunks by slug.`,
      inputSchema: {
        slug: z.string().describe("Page slug."),
        limit: z.number().optional().describe("Maximum chunks, default 20, max 100."),
      },
    },
    async (args) => text(await tools.get_chunks(args)),
  );
  if (!options.readOnly) {
    server.registerTool(
      "add_link",
      {
        title: "Legacy Add Link",
        description: `${legacy} Add a graph link.`,
        inputSchema: {
          from: z.string().describe("Source slug."),
          to: z.string().describe("Target slug."),
          type: z.string().optional().describe("Relationship type."),
          context: z.string().optional().describe("Relationship context."),
        },
      },
      async (args) => text(await tools.add_link(args)),
    );
    server.registerTool(
      "remove_link",
      {
        title: "Legacy Remove Link",
        description: `${legacy} Remove graph links between two slugs.`,
        inputSchema: {
          from: z.string().describe("Source slug."),
          to: z.string().describe("Target slug."),
        },
      },
      async (args) => text(await tools.remove_link(args)),
    );
  }
  server.registerTool(
    "get_links",
    {
      title: "Legacy Get Links",
      description: `${legacy} Read outgoing links.`,
      inputSchema: {
        slug: z.string().describe("Page slug."),
        limit: z.number().optional().describe("Maximum links, default 50, max 200."),
      },
    },
    async (args) => text(await tools.get_links(args)),
  );
  server.registerTool(
    "get_backlinks",
    {
      title: "Legacy Get Backlinks",
      description: `${legacy} Read incoming links.`,
      inputSchema: {
        slug: z.string().describe("Page slug."),
        limit: z.number().optional().describe("Maximum backlinks, default 50, max 200."),
      },
    },
    async (args) => text(await tools.get_backlinks(args)),
  );
  server.registerTool(
    "traverse_graph",
    {
      title: "Legacy Traverse Graph",
      description: `${legacy} Traverse graph around a slug.`,
      inputSchema: {
        slug: z.string().describe("Focus slug."),
        depth: z.number().optional().describe("Traversal depth, max 5."),
        direction: z.enum(["in", "out", "both"]).optional().describe("Traversal direction."),
      },
    },
    async (args) => text(await tools.traverse_graph(args)),
  );
  if (!options.readOnly) {
    server.registerTool(
      "add_tag",
      {
        title: "Legacy Add Tag",
        description: `${legacy} Add one tag.`,
        inputSchema: {
          slug: z.string().describe("Page slug."),
          tag: z.string().describe("Tag to add."),
        },
      },
      async (args) => text(await tools.add_tag(args)),
    );
    server.registerTool(
      "remove_tag",
      {
        title: "Legacy Remove Tag",
        description: `${legacy} Remove one tag.`,
        inputSchema: {
          slug: z.string().describe("Page slug."),
          tag: z.string().describe("Tag to remove."),
        },
      },
      async (args) => text(await tools.remove_tag(args)),
    );
  }
  server.registerTool(
    "get_tags",
    {
      title: "Legacy Get Tags",
      description: `${legacy} Read page tags.`,
      inputSchema: { slug: z.string().describe("Page slug.") },
    },
    async (args) => text(await tools.get_tags(args)),
  );
  server.registerTool(
    "get_timeline",
    {
      title: "Legacy Get Timeline",
      description: `${legacy} Read page timeline entries.`,
      inputSchema: {
        slug: z.string().describe("Page slug."),
        limit: z.number().optional().describe("Maximum entries, default 20, max 100."),
      },
    },
    async (args) => text(await tools.get_timeline(args)),
  );
}

function registerResources(server: McpServer, tools: ReturnType<typeof createMcpToolHandlers>) {
  server.registerResource(
    "health",
    "memoark://health",
    {
      title: "Memoark Health",
      description: "Memoark MCP health, version, and capability metadata.",
      mimeType: "application/json",
    },
    async (uri) => jsonResource(uri.toString(), await tools.get_health()),
  );

  server.registerResource(
    "pages",
    "memoark://pages",
    {
      title: "Memoark Pages",
      description: "Bounded page index for browsing available memory pages.",
      mimeType: "application/json",
    },
    async (uri) =>
      jsonResource(uri.toString(), {
        pages: await tools.list_pages({ limit: LIST_MAX_LIMIT }),
        limit: LIST_MAX_LIMIT,
      }),
  );

  server.registerResource(
    "page",
    new ResourceTemplate("memoark://pages/{slug}", { list: undefined }),
    {
      title: "Memoark Page",
      description: "Read a Memoark page by URL-encoded slug.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const page = await tools.get_page({ slug: decodeSlug(variables.slug) });
      return jsonResource(uri.toString(), isToolError(page) ? page : { page });
    },
  );

  server.registerResource(
    "page-context",
    new ResourceTemplate("memoark://pages/{slug}/context", { list: undefined }),
    {
      title: "Memoark Page Context",
      description: "Read a page plus tags, links, backlinks, timeline, chunks, and provenance.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.toString(),
        await tools.get_page_context({
          slug: decodeSlug(variables.slug),
          include: { links: true, backlinks: true, timeline: true, chunks: true },
          limit: LIST_MAX_LIMIT,
        }),
      ),
  );

  server.registerResource(
    "page-timeline",
    new ResourceTemplate("memoark://pages/{slug}/timeline", { list: undefined }),
    {
      title: "Memoark Page Timeline",
      description: "Read bounded timeline entries for a Memoark page.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const slug = decodeSlug(variables.slug);
      const timeline = await tools.get_timeline({ slug, limit: LIST_MAX_LIMIT });
      return jsonResource(
        uri.toString(),
        isToolError(timeline) ? timeline : { slug, timeline, limit: LIST_MAX_LIMIT },
      );
    },
  );
}

function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "recall",
    {
      title: "Recall Memory",
      description: "Recall cross-source memories about a topic using query and unified filters.",
      argsSchema: {
        topic: z.string().describe("Topic, question, person, project, or decision to recall."),
        platform: z.string().optional().describe("Optional platform filter such as `wechat`."),
        source_type: z.string().optional().describe("Optional source type such as `dm`."),
        participant: z.string().optional().describe("Optional exact participant display name."),
        from: z.string().optional().describe("Optional ISO lower time bound."),
        to: z.string().optional().describe("Optional ISO upper time bound."),
      },
    },
    async ({ topic, platform, source_type, participant, from, to }) => ({
      description: "Recall relevant Memoark memories with provenance.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use the \`query\` tool to recall Memoark memories about: ${topic}.`,
              "Apply only the filters that are provided.",
              platform ? `platform: ${platform}` : undefined,
              source_type ? `source_type: ${source_type}` : undefined,
              participant ? `participant: ${participant}` : undefined,
              from ? `from: ${from}` : undefined,
              to ? `to: ${to}` : undefined,
              "Return a concise answer with cited provenance from the tool result.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "weekly-digest",
    {
      title: "Weekly Digest",
      description: "Summarize recent activity from timeline_feed.",
      argsSchema: {
        days: z.string().describe("Number of recent days to cover, for example `7`."),
        platform: z.string().optional().describe("Optional platform filter."),
        participant: z.string().optional().describe("Optional participant filter."),
      },
    },
    async ({ days, platform, participant }) => ({
      description: "Create a recent Memoark activity digest.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use \`timeline_feed\` to summarize the last ${days} days of Memoark activity.`,
              "Use date filters if the client provides absolute dates.",
              platform ? `Apply platform filter: ${platform}` : undefined,
              participant ? `Apply participant filter: ${participant}` : undefined,
              "Group results by project, decision, task, and open question.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "who-is",
    {
      title: "Who Is",
      description: "Build a person context brief from Memoark memory.",
      argsSchema: {
        person: z.string().describe("Person name or slug to investigate."),
      },
    },
    async ({ person }) => ({
      description: "Create a person brief.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use \`query\` with participant filter when helpful, then \`get_page_context\` for the best slug, to explain who ${person} is and how they relate to current work. Cite provenance.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "decision-log",
    {
      title: "Decision Log",
      description: "Collect decisions related to a topic.",
      argsSchema: {
        topic: z.string().describe("Decision topic, project, or keyword."),
        from: z.string().optional().describe("Optional ISO lower time bound."),
        to: z.string().optional().describe("Optional ISO upper time bound."),
      },
    },
    async ({ topic, from, to }) => ({
      description: "Create a decision log.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use \`search\` for exact decision keywords and \`query\` for related decisions about: ${topic}.`,
              "Use type filters such as decision when appropriate.",
              from ? `from: ${from}` : undefined,
              to ? `to: ${to}` : undefined,
              "Return date, decision, rationale, status, and provenance.",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "handoff",
    {
      title: "Project Handoff",
      description: "Prepare a project handoff brief using high-intent memory tools.",
      argsSchema: {
        project: z.string().describe("Project name or slug."),
      },
    },
    async ({ project }) => ({
      description: "Create a project handoff brief.",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use \`query\` to find the best project slug for ${project}, then use \`get_page_context\`, \`timeline_feed\`, and \`explore_graph\` to produce a handoff covering status, decisions, risks, owners, next steps, and provenance.`,
          },
        },
      ],
    }),
  );
}

function registerMainTools(
  server: McpServer,
  tools: ReturnType<typeof createMcpToolHandlers>,
  ingestDeps?: IngestDeps,
) {
  server.registerTool(
    "get_session_context",
    {
      title: "Get Session Context",
      description: description(
        "get_session_context",
        "Load working memory for session bootstrap.\n\nWhen to use: at the start of every session to understand what is active and pending.\nReturns: recent activity summary for the given day window.",
      ),
      inputSchema: { days: z.number().optional().describe("Number of recent days, default 7.") },
    },
    async (args) => text(await tools.get_session_context(args)),
  );

  server.registerTool(
    "list_signals_by_entity",
    {
      title: "List Signals by Entity",
      description: description(
        "list_signals_by_entity",
        "List all signals anchored to an entity.\n\nWhen to use: retrieve decisions, tasks, knowledge, etc. for a specific person/project/tool.\nReturns: signals with type, title, and summary.",
      ),
      inputSchema: {
        entity_slug: z.string().describe("Entity slug, for example `entities/alice`."),
        signal_types: z.array(z.string()).optional().describe("Optional signal type filter."),
        limit: z.number().optional().describe("Maximum signals, default 20."),
      },
    },
    async (args) => text(await tools.list_signals_by_entity(args)),
  );

  server.registerTool(
    "get_entity_profile",
    {
      title: "Get Entity Profile",
      description: description(
        "get_entity_profile",
        "Full profile for an entity: signals + timeline.\n\nWhen to use: need a comprehensive view of a person, project, or tool.\nReturns: entity page with all linked signals and timeline.",
      ),
      inputSchema: {
        entity_slug: z.string().describe("Entity slug, for example `entities/alice`."),
      },
    },
    async (args) => text(await tools.get_entity_profile(args)),
  );

  // ── Person identity (Layer 1: aliases / merge / rename) ──────────────
  const handleKind = z.enum(["feishu_open_id", "email", "name", "nickname", "slug"]);
  server.registerTool(
    "link_person_alias",
    {
      title: "Link Person Alias",
      description: description(
        "link_person_alias",
        "Add an alias handle to a canonical person page.\n\nWhen to use: link a new identifier (email, feishu_open_id, nickname) to a person.\nReturns: ok plus current handles.",
      ),
      inputSchema: {
        canonical_slug: z.string().describe("Canonical person page slug."),
        kind: handleKind.describe("Handle kind."),
        value: z.string().describe("Handle value."),
        strength: z
          .enum(["strong", "weak"])
          .optional()
          .describe("Handle strength, default strong."),
      },
    },
    async (args) => text(await tools.link_person_alias(args)),
  );

  server.registerTool(
    "list_person_handles",
    {
      title: "List Person Handles",
      description: description(
        "list_person_handles",
        "List all handles for a canonical person.\n\nWhen to use: check known aliases for a person.\nReturns: array of handles with kind, value, and strength.",
      ),
      inputSchema: {
        canonical_slug: z.string().describe("Canonical person page slug."),
      },
    },
    async (args) => text(await tools.list_person_handles(args)),
  );

  server.registerTool(
    "remove_person_alias",
    {
      title: "Remove Person Alias",
      description: description(
        "remove_person_alias",
        "Remove a handle from any person.\n\nWhen to use: correct a wrong alias assignment.\nReturns: ok.",
      ),
      inputSchema: {
        kind: handleKind.describe("Handle kind."),
        value: z.string().describe("Handle value to remove."),
      },
    },
    async (args) => text(await tools.remove_person_alias(args)),
  );

  server.registerTool(
    "merge_persons",
    {
      title: "Merge Persons",
      description: description(
        "merge_persons",
        "Merge one person into another, moving all handles.\n\nWhen to use: two person pages represent the same individual.\nReturns: ok plus merged handles.",
      ),
      inputSchema: {
        from: z.string().describe("Source person slug to merge from."),
        into: z.string().describe("Target person slug to merge into."),
      },
    },
    async (args) => text(await tools.merge_persons(args)),
  );

  server.registerTool(
    "recanonicalize_person",
    {
      title: "Recanonicalize Person",
      description: description(
        "recanonicalize_person",
        "Rename a person's canonical slug.\n\nWhen to use: correct or update a person's canonical page slug.\nReturns: ok plus updated handles.",
      ),
      inputSchema: {
        from: z.string().describe("Current canonical slug."),
        to: z.string().describe("New canonical slug."),
      },
    },
    async (args) => text(await tools.recanonicalize_person(args)),
  );

  if (ingestDeps) {
    server.registerTool(
      "ingest_feishu_doc",
      {
        title: "Ingest Feishu Document",
        description: description(
          "ingest_feishu_doc",
          "Ingest a Feishu document into Memoark.\n\nWhen to use: import a Feishu doc by URL or token.\nReturns: ingest result with slug and status.",
        ),
        inputSchema: {
          url_or_token: z.string().describe("Feishu document URL or token."),
          note: z.string().optional().describe("Optional note to attach."),
          tags: z.array(z.string()).optional().describe("Optional tags to apply."),
          force_refresh: z.boolean().optional().describe("Force re-ingest even if cached."),
        },
      },
      async (args) => {
        const TIMEOUT_MS = 15_000;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<{
          ok: false;
          error: {
            code: "LLM_FAILED";
            doc_token: string;
            saved_as: "pointer";
            original_error: string;
          };
        }>((resolve) => {
          timer = setTimeout(
            () =>
              resolve({
                ok: false,
                error: {
                  code: "LLM_FAILED",
                  doc_token: "",
                  saved_as: "pointer",
                  original_error: "timeout_15s",
                },
              }),
            TIMEOUT_MS,
          );
        });
        const result = await Promise.race([ingestFeishuDoc(ingestDeps, args), timeout]);
        clearTimeout(timer);
        return text(result);
      },
    );
  }
}

export function createMcpServer(
  stores: StoreContext,
  options: McpServerOptions = {},
  ingestDeps?: IngestDeps,
): McpServer {
  const server = new McpServer({ name: "memoark", version: options.version ?? packageVersion });
  const tools = createMcpToolHandlers(stores, {
    exposeLegacyTools: options.exposeLegacyTools ?? false,
    readOnly: options.readOnly ?? false,
    version: options.version ?? packageVersion,
    provider: options.provider,
    synthModel: options.synthModel,
  });

  registerPreferredTools(server, tools, options);
  registerMainTools(server, tools, ingestDeps);
  if (options.exposeLegacyTools) registerLegacyTools(server, tools, options);
  registerResources(server, tools);
  registerPrompts(server);

  return server;
}

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import type { Config, LoadedConfig } from "./core/config.js";
import { PersonIdentityStore } from "./core/person-identity.js";
import { nodeRunner } from "./daemon/autostart/runner.js";
import { AgentSessionStore } from "./store/agent-sessions.js";
import { ChunkStore } from "./store/chunks.js";
import { Database } from "./store/database.js";
import { EmbeddingService } from "./store/embedding.js";
import { GraphStore } from "./store/graph.js";
import type { ManagedSupervisor } from "./store/managed/managed-engine.js";
import { provisionManaged } from "./store/managed/managed-engine.js";
import { managedPaths } from "./store/managed/pg-paths.js";
import { createPgRuntimeProvider } from "./store/managed/pg-runtime-provider.js";
import { createPgSupervisor } from "./store/managed/pg-supervisor.js";
import { PageStore } from "./store/pages.js";
import { PersonBehaviorStore } from "./store/person-behavior.js";
import { SearchEngine } from "./store/search.js";
import { TagStore } from "./store/tags.js";
import { TimelineStore } from "./store/timeline.js";

// Re-export the type so callers can import from one place.
export type { ManagedSupervisor };

function expandDataDir(dir: string, projectRoot: string): string {
  if (dir.startsWith("~/")) return resolve(homedir(), dir.slice(2));
  if (dir === "~") return homedir();
  if (isAbsolute(dir)) return dir;
  return resolve(projectRoot, dir);
}

export interface CreateStoresDeps {
  dbCreate?: typeof Database.create;
  provision?: (
    config: Config,
    deps: unknown,
  ) => Promise<{ supervisor: ManagedSupervisor; pgConfig: Config }>;
}

export interface ResolveDbResult {
  db: Database;
  supervisor?: ManagedSupervisor;
}

/**
 * Build a Database instance from config, branching on `store.engine`.
 *
 * - pglite (default): expands data_dir, creates the directory, passes a
 *   pglite-shaped config to dbCreate.
 * - postgres: passes the full config through unchanged so engine + database_url
 *   are preserved — fixes P0-1 where the old code forced pglite.
 * - managed: calls provision() to start/ensure the managed postgres process,
 *   then creates a Database with the returned pgConfig.
 */
export async function resolveDb(
  config: LoadedConfig,
  deps: CreateStoresDeps = {},
): Promise<ResolveDbResult> {
  const dbCreate = deps.dbCreate ?? Database.create;
  const provision = deps.provision ?? defaultProvision;

  const engine = config.store?.engine ?? "pglite";
  const dims = config.embedding?.dimensions;

  if (engine === "postgres") {
    const db = await dbCreate(config, { embeddingDimensions: dims });
    return { db };
  }

  if (engine === "managed") {
    const { supervisor, pgConfig } = await provision(config, defaultManagedDeps(config));
    const db = await dbCreate(pgConfig, { embeddingDimensions: dims });
    return { db, supervisor };
  }

  // pglite (default)
  const rawDir = config.store?.data_dir ?? "~/.memkin/data";
  const dataDir = expandDataDir(rawDir, config.__context.projectRoot);
  mkdirSync(dataDir, { recursive: true });
  const pgliteConfig: Config = {
    ...config,
    store: {
      ...config.store,
      engine: "pglite",
      data_dir: dataDir,
    },
  };
  const db = await dbCreate(pgliteConfig, { embeddingDimensions: dims });
  return { db };
}

// ---------------------------------------------------------------------------
// Default managed deps — Phase 2 placeholder
// ---------------------------------------------------------------------------

/**
 * Default ProvisionDeps for the managed engine path.
 * Wires the real createPgSupervisor (Phase 3 WARNING-1).
 */
export function defaultManagedDeps(config: Config) {
  const home = homedir();
  return {
    provider: createPgRuntimeProvider({
      home,
      pgMajor: "17",
      runtimeDir: config.store?.managed?.runtime_dir,
    }),
    makeSupervisor: (
      rt: import("./store/managed/pg-runtime-provider.js").RuntimePaths,
      h: string,
    ) =>
      createPgSupervisor({
        runtime: rt,
        paths: managedPaths(h, rt.pgMajor),
        runner: nodeRunner,
      }),
  };
}

/**
 * Default provision function — delegates to provisionManaged from managed-engine.ts.
 */
async function defaultProvision(
  config: Config,
  deps: unknown,
): Promise<{ supervisor: ManagedSupervisor; pgConfig: Config }> {
  return provisionManaged(config, deps as Parameters<typeof provisionManaged>[1]);
}

// ---------------------------------------------------------------------------
// createStores — full store wiring
// ---------------------------------------------------------------------------

export interface Stores {
  db: Database;
  pages: PageStore;
  chunks: ChunkStore;
  search: SearchEngine;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
  embedding: EmbeddingService;
  agentSessions: AgentSessionStore;
  supervisor?: ManagedSupervisor;
}

export async function createStores(
  config: LoadedConfig,
  deps: CreateStoresDeps = {},
): Promise<Stores> {
  const { db, supervisor } = await resolveDb(config, deps);
  const pages = new PageStore(db.executor);
  const chunks = new ChunkStore(db.executor);
  const embedding = new EmbeddingService(db.executor, {
    provider: config.embedding.provider as "openai" | "ollama",
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
    apiKey: config.embedding.api_key ?? process.env.OPENAI_API_KEY,
    baseUrl: config.embedding.base_url,
  });
  const search = new SearchEngine(db.executor, {
    embedText: (q) => embedding.embedText(q),
    search: {
      pool_by_page: config.search.pool_by_page,
      llm_rewrite: config.search.llm_rewrite,
    },
  });
  return {
    db,
    pages,
    chunks,
    search,
    graph: new GraphStore(db.executor),
    tags: new TagStore(db.executor),
    timeline: new TimelineStore(db.executor),
    embedding,
    agentSessions: new AgentSessionStore(db.executor),
    supervisor,
  };
}

// ---------------------------------------------------------------------------
// openIdentityStore — lightweight store for identity operations
// ---------------------------------------------------------------------------

export interface IdentityStores {
  db: Database;
  identity: PersonIdentityStore;
  supervisor?: ManagedSupervisor;
}

export async function openIdentityStore(
  config: LoadedConfig,
  deps: CreateStoresDeps = {},
): Promise<IdentityStores> {
  const { db, supervisor } = await resolveDb(config, deps);
  const identity = new PersonIdentityStore(
    db.executor,
    { pages: new PageStore(db.executor) },
    { behavior: new PersonBehaviorStore(db.executor) },
  );
  return { db, identity, supervisor };
}

// ---------------------------------------------------------------------------
// openSessionLedger — lightweight store for agent session ledger inspection
// ---------------------------------------------------------------------------

export interface SessionLedgerStores {
  db: Database;
  agentSessions: AgentSessionStore;
  supervisor?: ManagedSupervisor;
}

/**
 * Open just the agent session ledger — no EmbeddingService/SearchEngine, so
 * `memkin sessions ls/inspect` works without embedding credentials configured.
 */
export async function openSessionLedger(
  config: LoadedConfig,
  deps: CreateStoresDeps = {},
): Promise<SessionLedgerStores> {
  const { db, supervisor } = await resolveDb(config, deps);
  return { db, agentSessions: new AgentSessionStore(db.executor), supervisor };
}

import { mkdirSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import type { Config, LoadedConfig } from "./core/config.js";
import { Database } from "./store/database.js";
import { ChunkStore } from "./store/chunks.js";
import { EmbeddingService } from "./store/embedding.js";
import { GraphStore } from "./store/graph.js";
import { PageStore } from "./store/pages.js";
import { PersonBehaviorStore } from "./store/person-behavior.js";
import { PersonIdentityStore } from "./core/person-identity.js";
import { SearchEngine } from "./store/search.js";
import { TagStore } from "./store/tags.js";
import { TimelineStore } from "./store/timeline.js";
import type { ManagedSupervisor } from "./store/managed/managed-engine.js";
import { provisionManaged } from "./store/managed/managed-engine.js";
import { createPgRuntimeProvider } from "./store/managed/pg-runtime-provider.js";

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
  const rawDir = config.store?.data_dir ?? "~/.memoark/data";
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
 * `makeSupervisor` is intentionally unimplemented until Phase 2.
 */
function defaultManagedDeps(config: Config) {
  return {
    provider: createPgRuntimeProvider({
      home: homedir(),
      pgMajor: "17",
      runtimeDir: config.store?.managed?.runtime_dir,
    }),
    makeSupervisor: (_rt: unknown, _home: string): ManagedSupervisor => {
      throw new Error("managed supervisor not yet wired (Phase 2)");
    },
  };
}

/**
 * Default provision function — delegates to provisionManaged from managed-engine.ts.
 */
async function defaultProvision(
  config: Config,
  deps: unknown,
): Promise<{ supervisor: ManagedSupervisor; pgConfig: Config }> {
  return provisionManaged(
    config,
    deps as Parameters<typeof provisionManaged>[1],
  );
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

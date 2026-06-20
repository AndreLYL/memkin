import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { planStartup, shouldOpenBrowserOnServe } from "./cli-helpers.js";
import { normalizeDocsConfig } from "./collectors/feishu/docs/config.js";
import { FullCardBuilder } from "./collectors/feishu/docs/full-builder.js";
import type { IngestDeps } from "./collectors/feishu/docs/ingest.js";
import { runDocSource } from "./collectors/feishu/docs/run.js";
import { failedCards, summarizeCards } from "./collectors/feishu/docs/status.js";
import { loadExistingCard, writeCard } from "./collectors/feishu/docs/store-writer.js";
import { LarkCliHttpClient } from "./collectors/feishu/lark-cli-client.js";
import { resolveSelfOpenId } from "./collectors/feishu/self-open-id.js";
import {
  createClaudeCodeCollector,
  createCodexCollector,
  createFeishuCollector,
  createHermesCollector,
  getAllCollectors,
  getCollector,
  registerCollector,
  resetRegistry,
} from "./collectors/index.js";
import { type ConsolidateMode, Consolidator } from "./consolidator/consolidator.js";
import {
  type LoadedConfig,
  loadConfig,
  resolveConfigPath,
  type SourcesConfig,
} from "./core/config.js";
import { CursorStore } from "./core/cursors.js";
import { getMissingEnvVarsForCommand, validateEnvForCommand } from "./core/env-validation.js";
import { type HandleKind, PersonIdentityStore } from "./core/person-identity.js";
import { runPipeline } from "./core/pipeline.js";
import { buildPipelineConfig } from "./core/pipeline-factory.js";
import { ensureStateDir, statePath } from "./core/state.js";
import { buildServeRuntime, ServeRuntimeHolder } from "./daemon/serve-runtime.js";
import { ReloadManager } from "./daemon/reload-manager.js";
import { VERSION } from "./embedded-assets.generated.js";
import { createLLMProvider, createMockProvider } from "./extractors/providers/index.js";
import { createApiApp } from "./server/api.js";
import { createMcpServer } from "./server/mcp.js";
import { createMcpHttpApp } from "./server/mcp-http.js";
import { openBrowser } from "./server/open-browser.js";
import { startServer } from "./server/runtime.js";
import { ChunkStore } from "./store/chunks.js";
import { Database } from "./store/database.js";
import { EmbeddingService } from "./store/embedding.js";
import { GraphStore } from "./store/graph.js";
import { PageStore } from "./store/pages.js";
import { SearchEngine } from "./store/search.js";
import { TagStore } from "./store/tags.js";
import { TimelineStore } from "./store/timeline.js";

function resolveProjectPath(path: string | undefined, projectRoot: string): string | undefined {
  if (!path) return undefined;
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  if (path === "~") return homedir();
  if (isAbsolute(path)) return path;
  return resolve(projectRoot, path);
}

function bootstrapCollectors(sources: SourcesConfig, projectRoot: string): void {
  resetRegistry();
  const agentConfigs = {
    "claude-code": { factory: createClaudeCodeCollector, config: sources["claude-code"] },
    codex: { factory: createCodexCollector, config: sources.codex },
    hermes: { factory: createHermesCollector, config: sources.hermes },
  };

  for (const [_id, { factory, config }] of Object.entries(agentConfigs)) {
    if (config?.enabled !== false) {
      registerCollector(factory(resolveProjectPath(config?.base_dir, projectRoot)));
    }
  }

  if (sources.feishu?.enabled !== false && sources.feishu?.app_id) {
    registerCollector(createFeishuCollector(sources.feishu));
  }
}

function expandDataDir(dir: string, projectRoot: string): string {
  return resolveProjectPath(dir, projectRoot) ?? dir;
}

// Try to extract feishu.lark_bin from an existing config so the setup UI's
// "Feishu — Test Connection" button doesn't fall through to the hardcoded
// ~/.local/bin/lark path. Silent on missing file or parse errors (the wizard
// may be running because the YAML doesn't exist yet).
function readLarkBinFromConfig(configPath?: string): string | undefined {
  const path = configPath ?? resolve(process.cwd(), "memoark.yaml");
  if (!existsSync(path)) return undefined;
  try {
    return loadConfig(path).sources?.feishu?.lark_bin;
  } catch {
    return undefined;
  }
}

async function createStores(config: LoadedConfig) {
  const dataDir = expandDataDir(config.store.data_dir, config.__context.projectRoot);
  mkdirSync(dataDir, { recursive: true });
  const db = await Database.create(dataDir, {
    embeddingDimensions: config.embedding.dimensions,
  });
  const pages = new PageStore(db.pg);
  const chunks = new ChunkStore(db.pg);
  const embedding = new EmbeddingService(db.pg, {
    provider: config.embedding.provider as "openai" | "ollama",
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
    apiKey: config.embedding.api_key ?? process.env.OPENAI_API_KEY,
    baseUrl: config.embedding.base_url,
  });
  const search = new SearchEngine(db.pg, { embedText: (q) => embedding.embedText(q) });
  return {
    db,
    pages,
    chunks,
    search,
    graph: new GraphStore(db.pg),
    tags: new TagStore(db.pg),
    timeline: new TimelineStore(db.pg),
    embedding,
  };
}

/**
 * Lightweight store for identity operations: opens only the Database + a
 * PersonIdentityStore. Deliberately avoids EmbeddingService so that person
 * alias/merge/rename never requires an LLM or embedding API key.
 */
async function openIdentityStore(config: LoadedConfig) {
  const dataDir = expandDataDir(config.store.data_dir, config.__context.projectRoot);
  mkdirSync(dataDir, { recursive: true });
  const db = await Database.create(dataDir, {
    embeddingDimensions: config.embedding.dimensions,
  });
  const identity = new PersonIdentityStore(db.pg, { pages: new PageStore(db.pg) });
  return { db, identity };
}

const program = new Command();

program
  .name("memoark")
  .description("Local-first personal memory extraction and storage")
  .version(VERSION);

program
  .command("init")
  .description("Interactive setup wizard - generates memoark.yaml")
  .option("--auto", "Automatic mode, no prompts")
  .option("--force", "Overwrite existing configuration")
  .option("-c, --config <path>", "Path to output config file (default: memoark.yaml)")
  .option("--no-tui", "Use non-TUI fallback")
  .option("--web", "Launch browser-based setup UI")
  .action(async (options) => {
    if (options.web) {
      const { startSetupServer } = await import("./server/setup-server.js");
      await startSetupServer({
        configPath: options.config,
        larkBin: readLarkBinFromConfig(options.config),
      });
      return;
    }
    try {
      const { runInit } = await import("./setup/index.js");
      await runInit({
        auto: options.auto,
        force: options.force,
        configPath: options.config,
        tui: options.tui,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Extract command - main pipeline execution
 */
program
  .command("extract")
  .description("Extract signals from a platform or source")
  .option(
    "-s, --source <name>",
    "Source/collector name (e.g., claude-code, codex, hermes, feishu, or 'all' for all enabled sources)",
    "claude-code",
  )
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .option("-f, --format <type>", "Output format (json|markdown)", "json")
  .option("-a, --adapter <type>", "Output adapter (store|file|gbrain|stdout)", "store")
  .option("-o, --output <dir>", "Output directory for file adapter")
  .option("--since <date>", "Only process messages since date (ISO 8601 or relative: 1d, 2h, 30m)")
  .option("--limit <n>", "Limit number of messages to process", undefined)
  .option("--dry-run", "Do not write outputs, only test pipeline")
  .action(async (options) => {
    try {
      // Load configuration
      const config = loadConfig(options.config);
      const { projectRoot } = config.__context;

      // Ensure state directory exists
      ensureStateDir(projectRoot);

      // Bootstrap collectors from config
      bootstrapCollectors(config.sources, projectRoot);

      // Determine which sources to process
      let sourceIds: string[];
      if (options.source === "all") {
        sourceIds = getAllCollectors().map((c) => c.id);
      } else {
        sourceIds = [options.source];
      }

      // Create LLM provider based on config (shared across all sources)
      let provider: ReturnType<typeof createLLMProvider> | undefined;
      if (!options.dryRun) {
        validateEnvForCommand(config, "extract");
        const llmConfig = config.llm;
        const envKey =
          llmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY;
        if (!llmConfig.api_key && !envKey) {
          const envVarName =
            llmConfig.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
          console.error(
            `Error: No API key configured. Set api_key in memoark.yaml or ${envVarName} env var.`,
          );
          process.exit(1);
        }
        if (!llmConfig.api_key) {
          llmConfig.api_key = envKey;
        }
        provider = createLLMProvider(llmConfig);
      } else {
        provider = createMockProvider(new Map());
      }

      // Build pipeline configuration
      const pipelineConfig = buildPipelineConfig(
        config,
        options.output || process.cwd(),
        projectRoot,
      );

      // Parse options
      const format = ["json", "markdown"].includes(options.format) ? options.format : "json";
      const adapter = ["store", "file", "gbrain", "stdout"].includes(options.adapter)
        ? options.adapter
        : "store";
      const limit = options.limit ? parseInt(options.limit, 10) : undefined;

      // Create stores if using store adapter
      let stores: Awaited<ReturnType<typeof createStores>> | undefined;
      if (adapter === "store") {
        stores = await createStores(config);
      }

      // Parse relative since values
      let sinceValue = options.since;
      if (sinceValue) {
        const relMatch = sinceValue.match(/^(\d+)([dhm])$/);
        if (relMatch) {
          const amount = parseInt(relMatch[1], 10);
          const unit = relMatch[2];
          const ms =
            unit === "d" ? amount * 86400000 : unit === "h" ? amount * 3600000 : amount * 60000;
          sinceValue = new Date(Date.now() - ms).toISOString();
        }
      }

      let anyFailed = false;

      // Process each source
      for (const sourceId of sourceIds) {
        const collector = getCollector(sourceId);
        if (!collector) {
          console.error(`Error: Unknown source '${sourceId}'`);
          anyFailed = true;
          continue;
        }

        // Health check
        const health = await collector.healthCheck();
        if (!health.ok) {
          if (options.source === "all") {
            console.warn(`Warning: ${sourceId} not available — ${health.message}. Skipping.`);
            continue;
          }
          console.error(`Error: ${sourceId} health check failed — ${health.message}`);
          process.exit(1);
        }

        // Run pipeline for this source
        console.log(`\n--- Extracting from: ${sourceId} ---`);
        console.log(`Format: ${format}, Adapter: ${adapter}`);
        if (options.dryRun) console.log("DRY-RUN mode enabled");
        if (sinceValue) console.log(`Since: ${sinceValue}`);
        if (limit) console.log(`Limit: ${limit} messages`);
        console.log("");

        try {
          const result = await runPipeline(pipelineConfig, {
            source: collector,
            provider,
            format: format as "json" | "markdown",
            adapter: adapter as "store" | "file" | "gbrain" | "stdout",
            stores,
            dryRun: options.dryRun || false,
            since: sinceValue,
            limit,
          });

          // Report results
          console.log("Pipeline execution complete:");
          console.log(`  Total messages: ${result.totalMessages}`);
          console.log(`  Total blocks: ${result.totalBlocks}`);
          console.log(`  OK blocks: ${result.okBlocks}`);
          console.log(`  Skipped blocks: ${result.skippedBlocks}`);
          console.log(`  Failed blocks: ${result.failedBlocks}`);

          if (result.warnings.length > 0) {
            console.log("\nWarnings:");
            for (const warning of result.warnings) {
              console.log(`  - ${warning}`);
            }
          }

          if (result.fatal) {
            console.error(`\nFatal error: ${result.error}`);
            anyFailed = true;
          }
        } catch (error) {
          console.error(
            `\nPipeline failed for ${sourceId}:`,
            error instanceof Error ? error.message : String(error),
          );
          anyFailed = true;
        }
      }

      // Close stores if they were created
      if (stores) {
        await stores.db.close();
      }

      if (anyFailed) {
        process.exit(1);
      }
    } catch (error) {
      console.error("Extract failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Doctor command - diagnose configuration and setup
 */
program
  .command("doctor")
  .description("Diagnose configuration and connectivity")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .action(async (options) => {
    const issues: string[] = [];
    const warnings: string[] = [];
    const ok: string[] = [];

    // Check config file
    const configPath = resolveConfigPath(options.config);
    let config: LoadedConfig | null = null;
    if (existsSync(configPath)) {
      ok.push(`Configuration file found: ${configPath}`);
      try {
        config = loadConfig(options.config);
        ok.push("Configuration loaded successfully");
      } catch (error) {
        issues.push(
          `Configuration loading failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } else {
      warnings.push(`Configuration file not found: ${configPath}`);
      warnings.push("Create one with: memoark init");
    }

    // Check state directory
    const projectRoot = config?.__context.projectRoot ?? dirname(configPath);
    const stateDir = resolve(projectRoot, ".memoark");
    if (existsSync(stateDir)) {
      ok.push(`State directory exists: ${stateDir}`);
    } else {
      warnings.push(`State directory does not exist: ${stateDir}`);
      warnings.push("It will be created automatically on first extract");
    }

    const cwdStateDir = resolve(process.cwd(), ".memoark");
    if (cwdStateDir !== stateDir && existsSync(cwdStateDir)) {
      warnings.push(`Legacy state directory found at current cwd: ${cwdStateDir}`);
      warnings.push(`Current config-root state directory is: ${stateDir}`);
      warnings.push("Move cursor/dedup files manually if you intended to reuse the old state.");
    }

    // Check LLM configuration
    if (config) {
      const missingEnvVars = getMissingEnvVarsForCommand(config, "doctor");
      if (missingEnvVars.length > 0) {
        warnings.push(`Missing environment variables: ${missingEnvVars.join(", ")}`);
        warnings.push(`Referenced by: ${config.__context.configPath}`);
      }

      if (config.llm?.provider && config.llm?.model) {
        ok.push(`LLM provider configured: ${config.llm.provider} / ${config.llm.model}`);

        const envKey = config.llm.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
        if (!missingEnvVars.includes(envKey)) {
          ok.push(`${config.llm.provider} API key configured`);
        } else {
          warnings.push(`${envKey} environment variable not set and no api_key in config`);
          warnings.push(`Set ${envKey} or add api_key to llm config`);
        }
      } else {
        issues.push("LLM provider or model not configured");
      }

      // Check sources
      bootstrapCollectors(config.sources, config.__context.projectRoot);
      for (const collector of getAllCollectors()) {
        const health = await collector.healthCheck();
        if (health.ok) {
          ok.push(`Source ${collector.id}: ${health.message}`);
        } else {
          warnings.push(`Source ${collector.id}: ${health.message}`);
        }
      }
    }

    // Report results
    console.log("=== Memoark Diagnostic Report ===\n");

    if (ok.length > 0) {
      console.log("✓ OK:");
      for (const msg of ok) {
        console.log(`  ${msg}`);
      }
      console.log("");
    }

    if (warnings.length > 0) {
      console.log("⚠ Warnings:");
      for (const msg of warnings) {
        console.log(`  ${msg}`);
      }
      console.log("");
    }

    if (issues.length > 0) {
      console.log("✗ Issues:");
      for (const msg of issues) {
        console.log(`  ${msg}`);
      }
      console.log("");
      process.exit(1);
    }

    console.log("No critical issues found.");
  });

/**
 * Config subcommand group
 */
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("init")
  .description("Generate memoark.yaml (alias for 'memoark init')")
  .option("--auto", "Automatic mode, no prompts")
  .option("--force", "Overwrite existing configuration")
  .option("-c, --config <path>", "Path to output config file (default: memoark.yaml)")
  .option("--no-tui", "Use non-TUI fallback")
  .action(async (options) => {
    try {
      const { runInit } = await import("./setup/index.js");
      await runInit({
        auto: options.auto,
        force: options.force,
        configPath: options.config,
        tui: options.tui,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

configCmd
  .command("edit")
  .description("Edit configuration in browser UI")
  .option("--web", "Launch browser-based settings UI (default behavior)")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .action(async (options) => {
    const { startSetupServer } = await import("./server/setup-server.js");
    await startSetupServer({
      configPath: options.config,
      larkBin: readLarkBinFromConfig(options.config),
    });
  });

/**
 * Sources subcommand group
 */
const sourcesCmd = program.command("sources").description("Manage data sources");

sourcesCmd
  .command("list")
  .description("List available sources")
  .option("-c, --config <path>", "Path to config file")
  .action((options) => {
    const config = loadConfig(options.config);
    bootstrapCollectors(config.sources, config.__context.projectRoot);

    const collectors = getAllCollectors();
    console.log("Available sources:\n");
    for (const c of collectors) {
      console.log(`  ${c.id}  ✓ enabled`);
      console.log(`    ${c.description}`);
      console.log("");
    }
  });

sourcesCmd
  .command("test <name>")
  .description("Test source connectivity and health")
  .option("-c, --config <path>", "Path to config file")
  .action(async (name, options) => {
    try {
      const config = loadConfig(options.config);
      bootstrapCollectors(config.sources, config.__context.projectRoot);

      const collector = getCollector(name);
      if (!collector) {
        console.error(`Error: Unknown source '${name}'`);
        process.exit(1);
      }

      console.log(`Testing source: ${name}\n`);
      const health = await collector.healthCheck();
      if (health.ok) {
        console.log(`✓ ${health.message}`);
      } else {
        console.log(`✗ ${health.message}`);
        process.exit(1);
      }
    } catch (error) {
      console.error("Test failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function runServe(options: {
  config?: string;
  mcp?: boolean;
  mcpHttp?: boolean;
  open?: boolean;
  pgliteAssets?: string;
  webDist?: string;
  port?: string;
}): Promise<void> {
  {
    const serveConfigPath = options.config ?? resolve(process.cwd(), "memoark.yaml");
    if (!existsSync(serveConfigPath)) {
      console.error(
        "No configuration file found.\n" +
          "Run `memoark start` for one-step setup + launch, or `memoark init --web` to configure first.",
      );
      process.exit(1);
    }
    const config = loadConfig(options.config);
    // Anchor the .memoark state dir to the config's project root, not process.cwd().
    // A Finder-launched sidecar has cwd=/, so the default would try to mkdir /.memoark
    // (EROFS on macOS). projectRoot = dirname(configPath), so it lives beside the config.
    const stateDir = ensureStateDir(config.__context.projectRoot);
    const missingEnvVars = getMissingEnvVarsForCommand(config, "serve");
    if (missingEnvVars.length > 0) {
      console.warn(
        `[warn] Missing env vars: ${missingEnvVars.join(", ")} (referenced by ${config.__context.configPath})`,
      );
    }
    const stores = await createStores(config);

    const initialRuntime = await buildServeRuntime(config, stores, stateDir);
    const holder = new ServeRuntimeHolder(initialRuntime);
    if (config.scheduler?.enabled) await holder.current.scheduler?.start();

    const reloadManager = new ReloadManager({
      holder,
      currentConfig: () => config,
      buildRuntime: (next) => buildServeRuntime(next, stores, stateDir),
    });

    const storesWithDaemon = {
      ...stores,
      getDaemonStatus: () => holder.current.getDaemonStatus(),
      get chatNameRefreshJob() { return holder.current.chatNameRefreshJob; },
    };

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return; // 防重入:连按 Ctrl-C 不会二次 db.close()
      shuttingDown = true;
      await holder.current.dispose();
      try {
        await stores.db.close(); // 触发锁 release
      } finally {
        process.exit(0); // db.close() 抛错也必须退出
      }
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    if (options.mcp) {
      let ingestDeps: IngestDeps | undefined;
      const feishu = config.sources.feishu;
      if (feishu?.enabled && feishu.sources?.docs?.enabled) {
        const client = new LarkCliHttpClient(feishu.lark_bin);
        const llmConfig = { ...config.llm };
        const envKey =
          llmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY;
        if (!llmConfig.api_key && envKey) llmConfig.api_key = envKey;
        const provider = llmConfig.api_key
          ? createLLMProvider(llmConfig)
          : createMockProvider(new Map());
        ingestDeps = {
          client,
          stores: storesWithDaemon,
          provider,
          model: feishu.sources.docs.llm?.model ?? llmConfig.model,
          nowIso: () => new Date().toISOString(),
        };
      }
      const server = createMcpServer(storesWithDaemon, {}, ingestDeps);
      await server.connect(new StdioServerTransport());
      return;
    }
    if (
      options.mcpHttp ||
      config.mcp.http.enabled ||
      config.server.mcp_transport === "streamable_http"
    ) {
      const tokenEnv = config.mcp.http.auth_token_env;
      const app = createMcpHttpApp(storesWithDaemon, {
        allowedOrigins: config.mcp.http.allowed_origins,
        allowedHosts: config.mcp.http.allowed_hosts,
        authToken: tokenEnv ? process.env[tokenEnv] : undefined,
        exposeLegacyTools: config.mcp.expose_legacy_tools,
        readOnly: config.mcp.http.read_only,
      });
      const server = await startServer(app, {
        hostname: config.mcp.http.bind_host,
        port: config.mcp.http.port,
      });
      console.log(
        `Memoark MCP Streamable HTTP listening on http://${server.hostname}:${server.port}/mcp`,
      );
      return;
    }

    const app = createApiApp(storesWithDaemon, {
      onConfigSaved: () => { void reloadManager.run(loadConfig(options.config)); },
    });
    // In a `bun --compile` sidecar, import.meta.url lives under $bunfs and web/dist is
    // NOT embedded, so the default path can't be served. The Tauri shell ships web/dist
    // as a resource and injects its real path via MEMOARK_WEB_DIST (mirrors pglite-assets).
    const webDist =
      process.env.MEMOARK_WEB_DIST ?? join(fileURLToPath(import.meta.url), "../../web/dist");
    // `--port 0` (used by the Tauri shell) binds an OS-assigned free port so the desktop
    // app never collides with a CLI `memoark serve`, a stale instance, or anything else
    // on the default port. The actual port is reported below for the webview to read.
    const requestedPort =
      options.port !== undefined ? Number(options.port) : config.server.http_port;
    const server = Bun.serve({
      port: requestedPort,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api")) return app.fetch(req);
        const filePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
        const candidate = Bun.file(join(webDist, filePath));
        if (await candidate.exists()) return new Response(candidate);
        return new Response(Bun.file(join(webDist, "index.html")));
      },
    });
    console.log(`Memoark HTTP API listening on http://localhost:${server.port}`);
    // Stdout contract for the Tauri shell: the URL after the marker is where the webview
    // navigates (the port may be OS-assigned, so report the real one — never hardcode).
    console.log(`MEMOARK_READY http://localhost:${server.port}`);
    if (
      shouldOpenBrowserOnServe({
        open: options.open !== false,
        mcp: !!options.mcp,
        mcpHttp: !!options.mcpHttp,
      })
    ) {
      openBrowser(`http://localhost:${server.port}`);
    }
    const activeScheduler = holder.current.scheduler;
    if (activeScheduler && config.scheduler?.enabled) {
      console.log(
        `Scheduler running — tick every ${config.scheduler.tick_interval_secs}s, sources: ${activeScheduler.getSourceIds().join(", ")}`,
      );
    }
  }
}

program
  .command("serve")
  .description("Start Memoark HTTP API or MCP stdio server")
  .option("-c, --config <path>", "Path to config file")
  .option("--mcp", "Run MCP stdio transport instead of HTTP")
  .option("--mcp-http", "Run MCP Streamable HTTP transport instead of the HTTP API")
  .option("--no-open", "Do not auto-open the browser after starting")
  .option(
    "--pglite-assets <dir>",
    "Directory holding bundled PGLite assets (compiled-sidecar mode; injected by the Tauri shell)",
  )
  .option(
    "--web-dist <dir>",
    "Directory holding the built web UI (compiled-sidecar mode; injected by the Tauri shell)",
  )
  .option(
    "--port <n>",
    "Override the HTTP port; 0 binds an OS-assigned free port (used by the Tauri shell)",
  )
  .action((options) => {
    if (options.pgliteAssets) process.env.MEMOARK_PGLITE_ASSETS = options.pgliteAssets;
    if (options.webDist) process.env.MEMOARK_WEB_DIST = options.webDist;
    return runServe(options);
  });

async function runStart(options: { config?: string }): Promise<void> {
  const configPath = options.config ?? resolve(process.cwd(), "memoark.yaml");
  const plan = planStartup(existsSync(configPath));
  if (plan.runSetup) {
    console.log("No configuration found — launching setup wizard...");
    const { startSetupServer } = await import("./server/setup-server.js");
    await startSetupServer({
      configPath: options.config,
      larkBin: readLarkBinFromConfig(options.config),
    });
  }
  await runServe({ config: options.config });
}

program
  .command("start")
  .description("One-step launch: setup if needed, then serve + open browser")
  .option("-c, --config <path>", "Path to config file")
  .action((options) => runStart(options));

program.action(() => runStart({}));

program
  .command("search <query>")
  .description("Search Memoark memory")
  .option("-c, --config <path>", "Path to config file")
  .option("--mode <mode>", "Search mode (hybrid|fts)", "hybrid")
  .option("--limit <n>", "Limit results", "20")
  .action(async (query, options) => {
    const config = loadConfig(options.config);
    validateEnvForCommand(config, "search", { searchMode: options.mode });
    const stores = await createStores(config);
    const limit = Number(options.limit);
    const results =
      options.mode === "fts"
        ? await stores.search.search(query, { limit })
        : await stores.search.query(query, { limit });
    for (const result of results) {
      console.log(`${result.slug}\t${result.score.toFixed(4)}\t${result.snippet.slice(0, 200)}`);
    }
    await stores.db.close();
  });

program
  .command("embed")
  .description("Embed stale Memoark chunks")
  .option("-c, --config <path>", "Path to config file")
  .option("--limit <n>", "Limit chunks")
  .action(async (options) => {
    const config = loadConfig(options.config);
    validateEnvForCommand(config, "embed");
    const stores = await createStores(config);
    const result = await stores.embedding.embedStale({
      limit: options.limit ? Number(options.limit) : undefined,
    });
    console.log(`Embedded ${result.embedded} chunks, errors ${result.errors}`);
    await stores.db.close();
  });

/**
 * Obsidian sync — bidirectional export/import between PGLite and a vault.
 * See docs/specs/memoark-2026-06-04-obsidian-sync.md
 */
program
  .command("export")
  .description("Export Memoark pages to an Obsidian vault (Markdown)")
  .requiredOption("--vault <path>", "Obsidian vault directory")
  .option("--force", "Ignore hash comparison, overwrite all files")
  .option("--dry-run", "Print intended actions without writing")
  .option("-c, --config <path>", "Path to config file")
  .action(async (options) => {
    const { exportToVault } = await import("./sync/obsidian.js");
    const stores = await createStores(loadConfig(options.config));
    try {
      const result = await exportToVault(stores, options.vault, {
        force: options.force,
        dryRun: options.dryRun,
      });
      console.log(
        `Exported: ${result.written} written, ${result.skipped} skipped, ${result.errors.length} errors`,
      );
      for (const err of result.errors) {
        console.error(`  error: ${err.slug}: ${err.reason}`);
      }
      if (options.dryRun) console.log("(dry-run: no files written)");
    } finally {
      await stores.db.close();
    }
  });

program
  .command("import")
  .description("Import an Obsidian vault back into Memoark")
  .requiredOption("--vault <path>", "Obsidian vault directory")
  .option("--force", "Ignore hash comparison, import all files")
  .option("--dry-run", "Print intended actions without writing")
  .option(
    "--strict-conflict",
    "Skip files where DB has changed since last sync instead of overwriting",
  )
  .option("-c, --config <path>", "Path to config file")
  .action(async (options) => {
    const { importFromVault } = await import("./sync/obsidian.js");
    const stores = await createStores(loadConfig(options.config));
    try {
      const result = await importFromVault(stores, options.vault, {
        force: options.force,
        dryRun: options.dryRun,
        strictConflict: options.strictConflict,
      });
      console.log(
        `Imported: ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`,
      );
      for (const w of result.warnings) {
        console.warn(`  warn: ${w.slug}: ${w.reason}`);
      }
      for (const err of result.errors) {
        console.error(`  error: ${err.file}: ${err.reason}`);
      }
      if (!options.dryRun && result.imported > 0) {
        console.log("Tip: Run 'memoark embed' to update embeddings for changed pages.");
      }
    } finally {
      await stores.db.close();
    }
  });

program
  .command("consolidate")
  .description("Run memory lifecycle tier rotation (hot→warm and/or warm→cold)")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .option("--hot", "Run hot→warm rotation only")
  .option("--warm", "Run warm→cold rotation only (requires LLM API key)")
  .option("--dry-run", "Report what would be consolidated without writing")
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const stores = await createStores(config);

      let llmProvider: ReturnType<typeof createLLMProvider> | undefined;
      if (options.warm || (!options.hot && !options.warm)) {
        const llmConfig = config.llm;
        const envKey =
          llmConfig.provider === "anthropic"
            ? process.env.ANTHROPIC_API_KEY
            : process.env.OPENAI_API_KEY;
        const apiKey = llmConfig.api_key ?? envKey;
        if (apiKey) {
          if (!llmConfig.api_key) llmConfig.api_key = apiKey;
          llmProvider = createLLMProvider(llmConfig);
        } else if (options.warm) {
          // Explicit --warm with no LLM key: fail fast
          console.error(
            "Error: --warm requires an LLM API key. Set ANTHROPIC_API_KEY or configure api_key in memoark.yaml.",
          );
          process.exit(1);
        } else {
          // Full run with no LLM: skip warm→cold, run hot only
          console.warn(
            "Warning: no LLM API key found. Running hot→warm only. " +
              "Set ANTHROPIC_API_KEY to enable warm→cold consolidation.",
          );
        }
      }

      const consolidator = new Consolidator(
        {
          pages: stores.pages,
          graph: stores.graph,
          tags: stores.tags,
          timeline: stores.timeline,
        },
        llmProvider,
      );

      const mode: ConsolidateMode = options.hot
        ? "hot"
        : options.warm
          ? "warm"
          : llmProvider
            ? "all"
            : "hot"; // fall back to hot-only when full run has no LLM
      const dryRun = options.dryRun ?? false;

      if (dryRun) console.log("DRY-RUN mode — no writes will occur\n");

      const result = await consolidator.runOnce(mode, dryRun);

      console.log("Consolidation complete:");
      console.log(`  hot→warm pages moved:    ${result.hotToWarm}`);
      console.log(`  warm→cold pages archived: ${result.warmToCold}`);
      console.log(`  dead links checked:       ${result.deadLinksChecked}`);
      console.log(`  preferences inferred:     ${result.preferencesInferred}`);

      await stores.db.close();
    } catch (error) {
      console.error("Consolidate failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ── Person identity (Layer 1: aliases / merge / rename) ────────────────────
const HANDLE_KINDS: HandleKind[] = ["feishu_open_id", "email", "name", "nickname", "slug"];

const identityCmd = program
  .command("identity")
  .description("Manage person identity: aliases, merge, and rename");

identityCmd
  .command("alias <canonical_slug> <kind> <value>")
  .description(`Attach an alias/handle to a person. kind: ${HANDLE_KINDS.join(" | ")}`)
  .option("-c, --config <path>", "Path to config file")
  .option("--strong", "Force strong strength (auto-resolvable)")
  .option("--weak", "Force weak strength (explicit-only)")
  .action(async (canonicalSlug, kind, value, options) => {
    if (!HANDLE_KINDS.includes(kind as HandleKind)) {
      console.error(`Error: invalid kind '${kind}'. Expected one of: ${HANDLE_KINDS.join(", ")}`);
      process.exit(1);
    }
    const { db, identity } = await openIdentityStore(loadConfig(options.config));
    try {
      const strength = options.strong ? "strong" : options.weak ? "weak" : undefined;
      await identity.addAlias(canonicalSlug, kind as HandleKind, value, strength);
      console.log(`Linked ${kind}:${value} → ${canonicalSlug}`);
      for (const h of await identity.listHandles(canonicalSlug)) {
        console.log(`  ${h.kind}\t${h.value}\t(${h.strength})`);
      }
    } catch (error) {
      console.error("alias failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await db.close();
    }
  });

identityCmd
  .command("handles <canonical_slug>")
  .description("List all handles/aliases attached to a person")
  .option("-c, --config <path>", "Path to config file")
  .action(async (canonicalSlug, options) => {
    const { db, identity } = await openIdentityStore(loadConfig(options.config));
    try {
      const handles = await identity.listHandles(canonicalSlug);
      if (handles.length === 0) {
        console.log(`No handles for ${canonicalSlug}`);
      } else {
        for (const h of handles) console.log(`${h.kind}\t${h.value}\t(${h.strength})`);
      }
    } finally {
      await db.close();
    }
  });

identityCmd
  .command("merge <from> <into>")
  .description("Merge person page <from> into <into> (re-points links/timeline/tags + aliases)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (from, into, options) => {
    const { db, identity } = await openIdentityStore(loadConfig(options.config));
    try {
      await identity.merge(from, into);
      console.log(`Merged ${from} → ${into}`);
      console.log("Note: run `memoark embed` to re-embed the folded content.");
    } catch (error) {
      console.error("merge failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await db.close();
    }
  });

identityCmd
  .command("rename <from> <to>")
  .description("Rename a person's canonical slug (correct a wrong canonicalization)")
  .option("-c, --config <path>", "Path to config file")
  .action(async (from, to, options) => {
    const { db, identity } = await openIdentityStore(loadConfig(options.config));
    try {
      await identity.recanonicalize(from, to);
      console.log(`Renamed ${from} → ${to}`);
    } catch (error) {
      console.error("rename failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await db.close();
    }
  });

const docsCmd = program.command("docs").description("Feishu doc summary cards (DocSource v2)");

docsCmd
  .command("sync")
  .description("Scan Feishu docs, build pointer cards, upgrade triggered docs to full cards")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      ensureStateDir();
      const feishu = config.sources.feishu;
      if (!feishu?.enabled || !feishu.sources?.docs?.enabled) {
        console.error(
          "Feishu docs source is not enabled in config (sources.feishu.sources.docs.enabled).",
        );
        process.exit(1);
      }
      const stores = await createStores(config);
      const client = new LarkCliHttpClient(feishu.lark_bin);
      const docsConfig = normalizeDocsConfig(feishu.sources.docs);

      // self_open_id: config override else resolve via lark-cli whoami helper used elsewhere
      const selfOpenId =
        docsConfig.self_open_id ??
        (await resolveSelfOpenId(client, feishu.sources?.dm?.self_open_id)) ??
        "";

      const llmConfig = { ...config.llm };
      if (docsConfig.llm.model) llmConfig.model = docsConfig.llm.model;
      const envKey =
        llmConfig.provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY;
      if (!llmConfig.api_key && envKey) llmConfig.api_key = envKey;
      const provider = llmConfig.api_key
        ? createLLMProvider(llmConfig)
        : createMockProvider(new Map());

      const cursor = new CursorStore(statePath("cursors.yaml"));
      cursor.load();

      const stats = await runDocSource({
        client,
        stores,
        provider,
        config: docsConfig,
        cursor,
        selfOpenId,
        nowMs: Date.now(),
        nowIso: () => new Date().toISOString(),
      });

      console.log(
        `[docs] scanned=${stats.candidates_scanned} pointer=${stats.pointer_saved} full=${stats.full_card_generated} skipped=${stats.skipped} queue=${stats.upgrade_queue_size} llm_failed=${stats.llm_failed}`,
      );
      await stores.db.close();
    } catch (error) {
      console.error("docs sync failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

docsCmd
  .command("status")
  .description("Show Feishu doc card counts")
  .option("-c, --config <path>", "Path to config file")
  .option("--failed", "List cards whose last extraction failed")
  .action(async (options) => {
    try {
      const config = loadConfig(options.config);
      const stores = await createStores(config);
      const pages = await stores.pages.listPages({ type: "feishu_doc_card", limit: 100000 });
      if (options.failed) {
        for (const f of failedCards(pages as never)) console.log(`${f.doc_token}\t${f.error}`);
      } else {
        const s = summarizeCards(pages as never);
        console.log(`total=${s.total} full=${s.full} pointer=${s.pointer} failed=${s.failed}`);
      }
      await stores.db.close();
    } catch (error) {
      console.error("docs status failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

docsCmd
  .command("retry [doc_token]")
  .description("Retry full-card extraction for a failed doc (or --all-failed)")
  .option("-c, --config <path>", "Path to config file")
  .option("--all-failed", "Retry every card with an extract_error")
  .action(async (docToken, options) => {
    try {
      const config = loadConfig(options.config);
      const feishu = config.sources.feishu;
      if (!feishu?.sources?.docs?.enabled) {
        console.error("Feishu docs source not enabled.");
        process.exit(1);
      }
      const stores = await createStores(config);
      const client = new LarkCliHttpClient(feishu.lark_bin);
      const docsConfig = normalizeDocsConfig(feishu.sources.docs);
      const llmConfig = { ...config.llm };
      if (docsConfig.llm.model) llmConfig.model = docsConfig.llm.model;
      const envKey =
        llmConfig.provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY;
      if (!llmConfig.api_key && envKey) llmConfig.api_key = envKey;
      const provider = llmConfig.api_key
        ? createLLMProvider(llmConfig)
        : createMockProvider(new Map());
      const builder = new FullCardBuilder(client, provider, docsConfig.llm.model ?? "unknown", () =>
        new Date().toISOString(),
      );

      const tokens: string[] = [];
      if (options.allFailed) {
        const pages = await stores.pages.listPages({ type: "feishu_doc_card", limit: 100000 });
        for (const f of failedCards(pages as never)) tokens.push(f.doc_token);
      } else if (docToken) {
        tokens.push(docToken);
      } else {
        console.error("Provide a doc_token or --all-failed.");
        process.exit(1);
      }

      for (const token of tokens) {
        const existing = await loadExistingCard(stores, token);
        if (!existing) {
          console.warn(`skip ${token}: no existing card`);
          continue;
        }
        // retry intentionally re-evaluates the gate (no force); short/empty docs
        // stay pointers by design — unlike MCP ingest which forces.
        const card = await builder.build(existing);
        await writeCard(stores, card);
        if (card.extract_level === "pointer") {
          const reason = card.extract_error ?? card.extract_skipped ?? "unknown";
          console.log(`${token}: pointer (not upgraded — ${reason})`);
        } else {
          console.log(`${token}: full`);
        }
      }
      await stores.db.close();
    } catch (error) {
      console.error("docs retry failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

program.parse(process.argv);

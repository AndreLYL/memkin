import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { VERSION } from "./embedded-assets.generated.js";
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
import { loadConfig, type SourcesConfig } from "./core/config.js";
import { type PipelineConfig, runPipeline } from "./core/pipeline.js";
import { ensureStateDir, statePath } from "./core/state.js";
import { Scheduler } from "./daemon/scheduler.js";
import { createLLMProvider, createMockProvider } from "./extractors/providers/index.js";
import { createApiApp, type DaemonStatus } from "./server/api.js";
import { createMcpServer } from "./server/mcp.js";
import { ChunkStore } from "./store/chunks.js";
import { Database } from "./store/database.js";
import { EmbeddingService } from "./store/embedding.js";
import { GraphStore } from "./store/graph.js";
import { PageStore } from "./store/pages.js";
import { SearchEngine } from "./store/search.js";
import { TagStore } from "./store/tags.js";
import { TimelineStore } from "./store/timeline.js";

function bootstrapCollectors(sources: SourcesConfig): void {
  resetRegistry();
  const agentConfigs = {
    "claude-code": { factory: createClaudeCodeCollector, config: sources["claude-code"] },
    codex: { factory: createCodexCollector, config: sources.codex },
    hermes: { factory: createHermesCollector, config: sources.hermes },
  };

  for (const [_id, { factory, config }] of Object.entries(agentConfigs)) {
    if (config?.enabled !== false) {
      registerCollector(factory(config?.base_dir));
    }
  }

  if (sources.feishu?.enabled !== false && sources.feishu?.app_id) {
    registerCollector(createFeishuCollector(sources.feishu));
  }
}

function expandDataDir(dir: string): string {
  if (dir.startsWith("~/")) return resolve(homedir(), dir.slice(2));
  if (dir === "~") return homedir();
  return dir;
}

async function createStores(config: ReturnType<typeof loadConfig>) {
  const dataDir = expandDataDir(config.store.data_dir);
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

      // Ensure state directory exists
      ensureStateDir();

      // Bootstrap collectors from config
      bootstrapCollectors(config.sources);

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
      const pipelineConfig: PipelineConfig = {
        dedup_checkpoint: statePath("dedup.jsonl"),
        cursor_checkpoint: statePath("cursors.yaml"),
        block_gap_minutes: config.block_builder.block_gap_minutes,
        max_block_tokens: config.block_builder.max_block_tokens,
        max_block_messages: config.block_builder.max_block_messages,
        privacy: config.privacy,
        output_dir: options.output || process.cwd(),
        block_concurrency: config.pipeline?.block_concurrency,
      };

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
    const configPath = options.config || resolve(process.cwd(), "memoark.yaml");
    let config: ReturnType<typeof loadConfig> | null = null;
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
    const stateDir = resolve(process.cwd(), ".memoark");
    if (existsSync(stateDir)) {
      ok.push(`State directory exists: ${stateDir}`);
    } else {
      warnings.push(`State directory does not exist: ${stateDir}`);
      warnings.push("It will be created automatically on first extract");
    }

    // Check LLM configuration
    if (config) {
      if (config.llm?.provider && config.llm?.model) {
        ok.push(`LLM provider configured: ${config.llm.provider} / ${config.llm.model}`);

        const envKey = config.llm.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
        if (process.env[envKey] || config.llm.api_key) {
          ok.push(`${config.llm.provider} API key configured`);
        } else {
          warnings.push(`${envKey} environment variable not set and no api_key in config`);
          warnings.push(`Set ${envKey} or add api_key to llm config`);
        }
      } else {
        issues.push("LLM provider or model not configured");
      }

      // Check sources
      bootstrapCollectors(config.sources);
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
    bootstrapCollectors(config.sources);

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
      bootstrapCollectors(config.sources);

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

program
  .command("serve")
  .description("Start Memoark HTTP API or MCP stdio server")
  .option("-c, --config <path>", "Path to config file")
  .option("--mcp", "Run MCP stdio transport instead of HTTP")
  .action(async (options) => {
    const config = loadConfig(options.config);
    const stateDir = ensureStateDir();
    const stores = await createStores(config);

    let scheduler: Scheduler | undefined;

    if (config.scheduler?.enabled) {
      bootstrapCollectors(config.sources);

      const llmConfig = config.llm;
      const envKey =
        llmConfig.provider === "anthropic"
          ? process.env.ANTHROPIC_API_KEY
          : process.env.OPENAI_API_KEY;
      if (!llmConfig.api_key && envKey) llmConfig.api_key = envKey;
      const provider = llmConfig.api_key
        ? createLLMProvider(llmConfig)
        : createMockProvider(new Map());

      const pipelineConfig: PipelineConfig = {
        dedup_checkpoint: statePath("dedup.jsonl"),
        cursor_checkpoint: statePath("cursors.yaml"),
        block_gap_minutes: config.block_builder.block_gap_minutes,
        max_block_tokens: config.block_builder.max_block_tokens,
        max_block_messages: config.block_builder.max_block_messages,
        privacy: config.privacy,
        output_dir: process.cwd(),
        block_concurrency: config.pipeline?.block_concurrency,
      };

      scheduler = new Scheduler(config.scheduler, stateDir);
      scheduler.setRunSource(async (sourceId) => {
        const collector = getCollector(sourceId);
        if (!collector) throw new Error(`Unknown source: ${sourceId}`);
        return runPipeline(pipelineConfig, {
          source: collector,
          provider,
          format: "json",
          adapter: "store",
          stores,
          dryRun: false,
        });
      });
      scheduler.setOnTick((sourceId, result, duration_ms) => {
        const status = result.fatal ? "failed" : "ok";
        console.log(`[scheduler] ${sourceId}: ${status} (${duration_ms}ms)`);
      });
      await scheduler.start();
    }

    const getDaemonStatus = scheduler
      ? (): DaemonStatus => {
          const hb = scheduler?.getHeartbeat();
          const now = Date.now();
          let lastRunAt: number | null = null;
          let nextAt: number | null = null;
          for (const id of scheduler?.getSourceIds() ?? []) {
            const s = scheduler?.getSourceState(id);
            if (!s) continue;
            if (s.last_run_at !== null && (lastRunAt === null || s.last_run_at > lastRunAt)) {
              lastRunAt = s.last_run_at;
            }
            const next = s.last_run_at !== null ? s.last_run_at + s.interval_secs * 1000 : now;
            if (nextAt === null || next < nextAt) nextAt = next;
          }
          return {
            running: true,
            uptime_seconds: Math.floor((now - (hb?.daemon_started_at ?? now)) / 1000),
            last_run: lastRunAt ? new Date(lastRunAt).toISOString() : null,
            next_scheduled: nextAt !== null ? new Date(nextAt).toISOString() : null,
          };
        }
      : undefined;

    const storesWithDaemon = { ...stores, getDaemonStatus };

    const shutdown = () => {
      scheduler?.stop();
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    if (options.mcp) {
      const server = createMcpServer(storesWithDaemon);
      await server.connect(new StdioServerTransport());
      return;
    }

    const app = createApiApp(storesWithDaemon);
    const server = Bun.serve({ port: config.server.http_port, fetch: app.fetch });
    console.log(`Memoark HTTP API listening on http://localhost:${server.port}`);
    if (scheduler) {
      console.log(
        `Scheduler running — tick every ${config.scheduler?.tick_interval_secs}s, sources: ${scheduler.getSourceIds().join(", ")}`,
      );
    }
  });

program
  .command("search <query>")
  .description("Search Memoark memory")
  .option("-c, --config <path>", "Path to config file")
  .option("--mode <mode>", "Search mode (hybrid|fts)", "hybrid")
  .option("--limit <n>", "Limit results", "20")
  .action(async (query, options) => {
    const stores = await createStores(loadConfig(options.config));
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
    const stores = await createStores(loadConfig(options.config));
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

program.parse(process.argv);

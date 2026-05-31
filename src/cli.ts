#!/usr/bin/env bun
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createClaudeCodeCollector,
  createCodexCollector,
  createFeishuCollector,
  createHermesCollector,
  FeishuCollector,
  getAllCollectors,
  getCollector,
  registerCollector,
  resetRegistry,
} from "./collectors/index.js";
import { loadConfig, type SourcesConfig } from "./core/config.js";
import { IdentityResolver } from "./core/identity-resolver.js";
import { type PipelineConfig, runPipeline } from "./core/pipeline.js";
import { ensureStateDir, statePath } from "./core/state.js";
import { createLLMProvider, createMockProvider } from "./extractors/providers/index.js";
import { createApiApp } from "./server/api.js";
import { createMcpServer } from "./server/mcp.js";
import { ChunkStore } from "./store/chunks.js";
import { Database } from "./store/database.js";
import { EmbeddingService } from "./store/embedding.js";
import { GraphStore } from "./store/graph.js";
import { PageStore } from "./store/pages.js";
import { SearchEngine } from "./store/search.js";
import { TagStore } from "./store/tags.js";
import { TimelineStore } from "./store/timeline.js";

async function bootstrapCollectors(sources: SourcesConfig): Promise<void> {
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
    const feishuCollector = await createFeishuCollector(sources.feishu);
    registerCollector(feishuCollector);
  }
}

async function createStores(config: ReturnType<typeof loadConfig>) {
  const dataDir = config.store.data_dir.replace(/^~/, process.env.HOME ?? "~");
  mkdirSync(resolve(dataDir), { recursive: true });
  const db = await Database.create(dataDir);
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

function timestampForPath(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function backupStoreAndState(config: ReturnType<typeof loadConfig>): {
  dataBackup?: string;
  stateBackup?: string;
} {
  const stamp = timestampForPath();
  const dataDir = resolve(config.store.data_dir.replace(/^~/, process.env.HOME ?? "~"));
  const stateDir = resolve(process.cwd(), ".memoark");
  const result: { dataBackup?: string; stateBackup?: string } = {};

  if (existsSync(dataDir)) {
    const dataBackup = `${dataDir}.bak.${stamp}`;
    cpSync(dataDir, dataBackup, { recursive: true });
    result.dataBackup = dataBackup;
  }

  if (existsSync(stateDir)) {
    const stateBackup = `${stateDir}.bak.${stamp}`;
    cpSync(stateDir, stateBackup, { recursive: true });
    result.stateBackup = stateBackup;
  }

  return result;
}

function removeCursor(source: string): void {
  const cursorPath = statePath("cursors.yaml");
  if (!existsSync(cursorPath)) return;

  const raw = readFileSync(cursorPath, "utf-8");
  const data = parseYaml(raw) as Record<string, unknown> | null;
  if (!data || typeof data !== "object") return;
  if (!(source in data)) return;

  delete data[source];
  writeFileSync(cursorPath, stringifyYaml(data), "utf-8");
}

const program = new Command();

program
  .name("memoark")
  .description("Local-first personal memory extraction and storage")
  .version("0.1.0");

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
      await bootstrapCollectors(config.sources);

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
        if (!llmConfig.api_key && !process.env.OPENAI_API_KEY) {
          console.error(
            "Error: No API key configured. Set api_key in memoark.yaml or OPENAI_API_KEY env var.",
          );
          process.exit(1);
        }
        if (!llmConfig.api_key) {
          llmConfig.api_key = process.env.OPENAI_API_KEY;
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

      // Create identity resolver with feishu backend if available
      let identityDb: Awaited<ReturnType<typeof Database.create>> | undefined;
      let identityResolver: IdentityResolver | undefined;
      const pg = stores?.db.pg;
      const feishuCollector = getCollector("feishu");
      const identityBackend =
        feishuCollector instanceof FeishuCollector
          ? feishuCollector.getIdentityBackend()
          : undefined;
      if (pg) {
        identityResolver = new IdentityResolver(pg, identityBackend);
      } else {
        identityDb = await Database.create(config.store.data_dir);
        identityResolver = new IdentityResolver(identityDb.pg, identityBackend);
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
            identityResolver,
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
      if (identityDb) {
        await identityDb.close();
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
      warnings.push("Create one with: memoark config init");
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
      await bootstrapCollectors(config.sources);
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
 * Store subcommand group
 */
const storeCmd = program.command("store").description("Manage the local PGLite store");

storeCmd
  .command("purge-source <source>")
  .description("Delete stored signals and incremental state for one source")
  .option("-c, --config <path>", "Path to config file (default: memoark.yaml)")
  .option("--yes", "Apply the purge. Without this flag, only print the deletion plan.")
  .option("--keep-cursor", "Keep the source cursor in .memoark/cursors.yaml")
  .option(
    "--keep-dedup",
    "Keep .memoark/dedup.jsonl. Legacy dedup entries are not source-scoped, so this can skip old messages on rebuild.",
  )
  .action(async (source, options) => {
    const config = loadConfig(options.config);
    ensureStateDir();
    const stores = await createStores(config);
    const platform = String(source);

    try {
      const pages = await stores.db.pg.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
         FROM pages
         WHERE frontmatter->'source'->>'platform' = $1
            OR frontmatter->'first_seen'->>'platform' = $1`,
        [platform],
      );
      const links = await stores.db.pg.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
         FROM links
         WHERE provenance->>'platform' = $1`,
        [platform],
      );
      const timeline = await stores.db.pg.query<{ c: number }>(
        `SELECT COUNT(*)::int AS c
         FROM timeline_entries
         WHERE provenance->>'platform' = $1 OR source = $1`,
        [platform],
      );

      console.log(`Source purge plan: ${platform}`);
      console.log(`  Pages: ${pages.rows[0]?.c ?? 0}`);
      console.log(`  Links: ${links.rows[0]?.c ?? 0}`);
      console.log(`  Timeline entries: ${timeline.rows[0]?.c ?? 0}`);
      if (!options.keepCursor) console.log("  Cursor: remove source cursor");
      if (!options.keepDedup) {
        console.log("  Dedup: reset .memoark/dedup.jsonl after backup");
      }

      if (!options.yes) {
        console.log("\nDry run only. Re-run with --yes to apply.");
        return;
      }

      const backups = backupStoreAndState(config);
      if (backups.dataBackup) console.log(`Backup created: ${backups.dataBackup}`);
      if (backups.stateBackup) console.log(`State backup created: ${backups.stateBackup}`);

      await stores.db.pg.query("BEGIN");
      const deletedTimeline = await stores.db.pg.query<{ c: number }>(
        `WITH deleted AS (
           DELETE FROM timeline_entries
           WHERE provenance->>'platform' = $1 OR source = $1
           RETURNING 1
         )
         SELECT COUNT(*)::int AS c FROM deleted`,
        [platform],
      );
      const deletedLinks = await stores.db.pg.query<{ c: number }>(
        `WITH deleted AS (
           DELETE FROM links
           WHERE provenance->>'platform' = $1
           RETURNING 1
         )
         SELECT COUNT(*)::int AS c FROM deleted`,
        [platform],
      );
      const deletedPages = await stores.db.pg.query<{ c: number }>(
        `WITH deleted AS (
           DELETE FROM pages
           WHERE frontmatter->'source'->>'platform' = $1
              OR frontmatter->'first_seen'->>'platform' = $1
           RETURNING 1
         )
         SELECT COUNT(*)::int AS c FROM deleted`,
        [platform],
      );
      await stores.db.pg.query("COMMIT");

      if (!options.keepCursor) {
        removeCursor(platform);
      }
      if (!options.keepDedup) {
        writeFileSync(statePath("dedup.jsonl"), "", "utf-8");
      }

      console.log("Purge complete:");
      console.log(`  Deleted pages: ${deletedPages.rows[0]?.c ?? 0}`);
      console.log(`  Deleted links: ${deletedLinks.rows[0]?.c ?? 0}`);
      console.log(`  Deleted timeline entries: ${deletedTimeline.rows[0]?.c ?? 0}`);
    } catch (error) {
      try {
        await stores.db.pg.query("ROLLBACK");
      } catch {
        // Ignore rollback failures; the original error is more useful.
      }
      console.error("Purge failed:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await stores.db.close();
    }
  });

/**
 * Config subcommand group
 */
const configCmd = program.command("config").description("Manage configuration");

configCmd
  .command("init")
  .description("Generate memoark.yaml template")
  .action(() => {
    const template = `# Memoark Configuration
# Save this file as memoark.yaml in your project directory

# Privacy configuration
privacy:
  enabled: true
  mode: reversible  # reversible or irreversible
  redact_phone: true
  redact_id_card: true
  redact_bank_card: true
  redact_email: false
  redact_url: false
  blocked_words: []
  replacement: "[REDACTED]"

# LLM provider configuration
llm:
  provider: openai  # openai or mock
  model: gpt-4o-mini
  # base_url: https://api.openai.com/v1  # Optional, for custom endpoints
  # api_key: <your-api-key>  # Or set OPENAI_API_KEY env var

# Block builder configuration
block_builder:
  block_gap_minutes: 30  # Gap between messages to start a new block
  max_block_tokens: 4000  # Maximum tokens per block
  max_block_messages: 100  # Maximum messages per block

# Source configuration
sources:
  claude-code:
    enabled: true
    # base_dir: ~/.claude/projects/
  codex:
    enabled: true
    # base_dir: ~/.codex/
  hermes:
    enabled: true
    # base_dir: ~/.openclaw/agents/
  feishu:
    enabled: false
    app_id: \${FEISHU_APP_ID}
    app_secret: \${FEISHU_APP_SECRET}
    # base_url: https://open.feishu.cn  # Optional, defaults to feishu.cn
    # rate_limit_qps: 5
    sources:
      messages:
        enabled: false
        chat_ids: []
        # lookback_days: 30
      calendar:
        enabled: false
        calendar_ids: []
      docs:
        enabled: false
        doc_folders: []
      tasks:
        enabled: false
      dm:
        enabled: false
        dm_chat_ids: []
        self_open_id: ""
      message_search:
        enabled: false
        chat_types:
          - p2p
        # lookback_days: 3
        # page_size: 50

# Adapter configuration
adapters:
  file:
    enabled: false
    output_dir: ./output
  gbrain:
    enabled: false
    output_dir: ./gbrain-output

# Store (PGLite embedded PostgreSQL)
store:
  data_dir: ~/.memoark/data

# Embedding configuration
embedding:
  provider: ollama
  model: nomic-embed-text
  dimensions: 768
  # api_key: <your-api-key>  # Or set OPENAI_API_KEY env var
  # base_url: http://localhost:11434  # For Ollama

# Server configuration
server:
  http_port: 3927
`;

    const outputPath = resolve(process.cwd(), "memoark.yaml");
    writeFileSync(outputPath, template, "utf-8");
    console.log(`✓ Configuration template created: ${outputPath}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Edit memoark.yaml with your configuration");
    console.log("  2. Set LLM API key environment variable (OPENAI_API_KEY or ANTHROPIC_API_KEY)");
    console.log("  3. Run: memoark extract --source claude-code");
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
      await bootstrapCollectors(config.sources);

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
    const stores = await createStores(config);
    if (options.mcp) {
      const server = createMcpServer(stores);
      await server.connect(new StdioServerTransport());
      return;
    }
    const { Hono } = await import("hono");
    const { serveStatic } = await import("hono/bun");
    const { readFileSync } = await import("node:fs");
    const api = createApiApp(stores);
    const app = new Hono();
    app.route("/api", api);

    const distDir = "./web/dist";
    const hasFrontend = existsSync(`${distDir}/index.html`);

    if (hasFrontend) {
      app.use("/*", serveStatic({ root: distDir }));

      app.get("*", (c) => {
        if (c.req.path.startsWith("/api/")) {
          return c.json({ error: "Not found" }, 404);
        }
        if (!c.req.header("accept")?.includes("text/html")) {
          return c.json({ error: "Not found" }, 404);
        }
        return c.html(readFileSync(`${distDir}/index.html`, "utf-8"));
      });
    }

    const server = Bun.serve({ port: config.server.http_port, fetch: app.fetch });
    console.log(
      `Memoark ${hasFrontend ? "full-stack" : "HTTP API"} listening on http://localhost:${server.port}`,
    );
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

program.parse(process.argv);

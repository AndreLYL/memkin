import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Command } from "commander";
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
import {
  type LoadedConfig,
  loadConfig,
  resolveConfigPath,
  type SourcesConfig,
} from "./core/config.js";
import { getMissingEnvVarsForCommand, validateEnvForCommand } from "./core/env-validation.js";
import { runPipeline } from "./core/pipeline.js";
import { buildPipelineConfig } from "./core/pipeline-factory.js";
import { ensureStateDir } from "./core/state.js";
import { createLLMProvider, createMockProvider } from "./extractors/providers/index.js";
import { createApiApp } from "./server/api.js";
import { createMcpServer } from "./server/mcp.js";
import { createMcpHttpApp } from "./server/mcp-http.js";
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

const { version: pkgVersion } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

const program = new Command();

program
  .name("memoark")
  .description("Local-first personal memory extraction and storage")
  .version(pkgVersion);

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

program
  .command("serve")
  .description("Start Memoark HTTP API or MCP stdio server")
  .option("-c, --config <path>", "Path to config file")
  .option("--mcp", "Run MCP stdio transport instead of HTTP")
  .option("--mcp-http", "Run MCP Streamable HTTP transport instead of the HTTP API")
  .action(async (options) => {
    const config = loadConfig(options.config);
    const missingEnvVars = getMissingEnvVarsForCommand(config, "serve");
    if (missingEnvVars.length > 0) {
      console.warn(
        `[warn] Missing env vars: ${missingEnvVars.join(", ")} (referenced by ${config.__context.configPath})`,
      );
    }
    const stores = await createStores(config);
    if (options.mcp) {
      const server = createMcpServer(stores, {
        exposeLegacyTools: config.mcp.expose_legacy_tools,
      });
      await server.connect(new StdioServerTransport());
      return;
    }
    if (
      options.mcpHttp ||
      config.mcp.http.enabled ||
      config.server.mcp_transport === "streamable_http"
    ) {
      const tokenEnv = config.mcp.http.auth_token_env;
      const app = createMcpHttpApp(stores, {
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
    const app = createApiApp(stores);
    const server = await startServer(app, { port: config.server.http_port });
    console.log(`Memoark HTTP API listening on http://${server.hostname}:${server.port}`);
  });

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

program.parse(process.argv);

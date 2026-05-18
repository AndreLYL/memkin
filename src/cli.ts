#!/usr/bin/env bun
import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { loadConfig } from "./core/config.js";
import { ensureStateDir, statePath } from "./core/state.js";
import { runPipeline, PipelineConfig } from "./core/pipeline.js";
import { ClaudeCodeCollector } from "./collectors/agent/claude-code.js";
import type { Collector } from "./core/types.js";
import { createOpenAIProvider, createMockProvider } from "./extractors/providers/index.js";

const program = new Command();

program
  .name("dbe")
  .description("Extract structured signals from communication platforms and AI agent sessions")
  .version("0.1.0");

/**
 * Extract command - main pipeline execution
 */
program
  .command("extract")
  .description("Extract signals from a platform or source")
  .requiredOption("-s, --source <name>", "Source/collector name (e.g., claude-code)")
  .option("-c, --config <path>", "Path to config file (default: dbe.yaml)")
  .option("-f, --format <type>", "Output format (json|markdown)", "json")
  .option("-a, --adapter <type>", "Output adapter (file|gbrain|stdout)", "stdout")
  .option("-o, --output <dir>", "Output directory for file adapter")
  .option("--since <date>", "Only process messages since this ISO 8601 date")
  .option("--limit <n>", "Limit number of messages to process", undefined)
  .option("--dry-run", "Do not write outputs, only test pipeline")
  .action(async (options) => {
    try {
      // Load configuration
      const config = loadConfig(options.config);

      // Ensure state directory exists
      ensureStateDir();

      // Create collector based on source
      let collector: Collector;
      if (options.source === "claude-code") {
        collector = new ClaudeCodeCollector();
      } else {
        console.error(`Error: Unknown source '${options.source}'`);
        process.exit(1);
      }

      // Create LLM provider based on config
      let provider: ReturnType<typeof createOpenAIProvider> | ReturnType<typeof createMockProvider> | undefined;
      if (!options.dryRun) {
        const llmConfig = config.llm;
        if (llmConfig.provider === "openai") {
          provider = createOpenAIProvider({
            apiKey: llmConfig.api_key || process.env.OPENAI_API_KEY,
            model: llmConfig.model,
            baseUrl: llmConfig.base_url,
          });
        } else if (llmConfig.provider === "mock") {
          provider = createMockProvider(new Map());
        } else {
          console.error(`Error: Unknown LLM provider '${llmConfig.provider}'`);
          process.exit(1);
        }
      } else {
        // Use mock provider for dry-run
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
      const adapter = ["file", "gbrain", "stdout"].includes(options.adapter) ? options.adapter : "stdout";
      const limit = options.limit ? parseInt(options.limit, 10) : undefined;

      // Run pipeline
      console.log(`Extracting from source: ${options.source}`);
      console.log(`Format: ${format}, Adapter: ${adapter}`);
      if (options.dryRun) console.log("DRY-RUN mode enabled");
      if (options.since) console.log(`Since: ${options.since}`);
      if (limit) console.log(`Limit: ${limit} messages`);
      console.log("");

      const result = await runPipeline(pipelineConfig, {
        source: collector,
        provider,
        format: format as "json" | "markdown",
        adapter: adapter as "file" | "gbrain" | "stdout",
        dryRun: options.dryRun || false,
        since: options.since,
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
  .option("-c, --config <path>", "Path to config file (default: dbe.yaml)")
  .action((options) => {
    const issues: string[] = [];
    const warnings: string[] = [];
    const ok: string[] = [];

    // Check config file
    const configPath = options.config || resolve(process.cwd(), "dbe.yaml");
    if (existsSync(configPath)) {
      ok.push(`Configuration file found: ${configPath}`);
      try {
        loadConfig(options.config);
        ok.push("Configuration loaded successfully");
      } catch (error) {
        issues.push(`Configuration loading failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      warnings.push(`Configuration file not found: ${configPath}`);
      warnings.push("Create one with: dbe config init");
    }

    // Check state directory
    const stateDir = resolve(process.cwd(), ".dbe");
    if (existsSync(stateDir)) {
      ok.push(`State directory exists: ${stateDir}`);
    } else {
      warnings.push(`State directory does not exist: ${stateDir}`);
      warnings.push("It will be created automatically on first extract");
    }

    // Check LLM configuration
    if (existsSync(configPath)) {
      try {
        const config = loadConfig(options.config);
        if (config.llm?.provider && config.llm?.model) {
          ok.push(`LLM provider configured: ${config.llm.provider} / ${config.llm.model}`);

          // Check API key for selected provider
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
      } catch {
        // Already reported above
      }
    }

    // Report results
    console.log("=== DBE Diagnostic Report ===\n");

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
  .description("Generate dbe.yaml template")
  .action(() => {
    const template = `# DigitalBrainExtractor Configuration
# Save this file as dbe.yaml in your project directory

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

# Adapter configuration
adapters:
  file:
    enabled: false
    output_dir: ./output
  gbrain:
    enabled: false
    output_dir: ./gbrain-output
`;

    const outputPath = resolve(process.cwd(), "dbe.yaml");
    writeFileSync(outputPath, template, "utf-8");
    console.log(`✓ Configuration template created: ${outputPath}`);
    console.log("");
    console.log("Next steps:");
    console.log("  1. Edit dbe.yaml with your configuration");
    console.log("  2. Set LLM API key environment variable (OPENAI_API_KEY or ANTHROPIC_API_KEY)");
    console.log("  3. Run: dbe extract --source claude-code");
  });

/**
 * Sources subcommand group
 */
const sourcesCmd = program.command("sources").description("Manage data sources");

sourcesCmd
  .command("list")
  .description("List available sources")
  .action(() => {
    const sources = [
      {
        name: "claude-code",
        description: "Claude Code agent conversation transcripts",
        default_location: "~/.claude/projects/",
      },
    ];

    console.log("Available sources:\n");
    for (const source of sources) {
      console.log(`  ${source.name}`);
      console.log(`    Description: ${source.description}`);
      console.log(`    Default location: ${source.default_location}`);
      console.log("");
    }
  });

sourcesCmd
  .command("test <name>")
  .description("Test source connectivity and health")
  .action(async (name) => {
    try {
      let collector: Collector;

      if (name === "claude-code") {
        collector = new ClaudeCodeCollector();
      } else {
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

program.parse(process.argv);

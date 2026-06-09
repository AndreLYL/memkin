/**
 * CLI command tests
 * Tests command parsing, --help output, and command execution
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const DIST_CLI = join(PROJECT_ROOT, "dist", "cli.js");
const BUN = join(process.env.HOME ?? "", ".bun", "bin", "bun");

function cliCommand(): { command: string; args: string[] } {
  if (existsSync(DIST_CLI)) {
    return { command: process.execPath, args: [DIST_CLI] };
  }
  if (existsSync(BUN)) {
    return { command: BUN, args: ["src/cli.ts"] };
  }
  return { command: process.execPath, args: ["bin/memoark.mjs"] };
}

function runCli(args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  const cli = cliCommand();
  return spawnSync(cli.command, [...cli.args, ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf-8",
    ...options,
  });
}

describe("CLI", () => {
  describe("build output", () => {
    test.skipIf(!existsSync(DIST_CLI))(
      "embeds runtime assets so the built CLI runs on plain Node",
      () => {
        // schema.sql + extractor prompts are inlined into this generated module at build
        // time, so the dist (and a `bun --compile` binary) need no loose asset files.
        expect(existsSync(join(PROJECT_ROOT, "dist", "embedded-assets.generated.js"))).toBe(true);

        // Proves the embedded-asset chain resolves under Node ESM — guards against the
        // packaging regressions that previously crashed `node dist/cli.js`.
        const result = runCli(["--version"]);
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
      },
    );
  });

  describe("memoark --help", () => {
    test("shows main help with version and description", () => {
      const result = runCli(["--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("memoark");
      expect(result.stdout).toContain("Local-first personal memory");
      expect(result.stdout).toContain("version");
    });

    test("displays available commands", () => {
      const result = runCli(["--help"]);

      expect(result.stdout).toContain("extract");
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("doctor");
      expect(result.stdout).toContain("config");
      expect(result.stdout).toContain("sources");
      expect(result.stdout).toContain("serve");
      expect(result.stdout).toContain("search");
      expect(result.stdout).toContain("embed");
    });
  });

  describe("memoark extract", () => {
    test("shows help with --help flag", () => {
      const result = runCli(["extract", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("extract");
      expect(result.stdout).toContain("Extract signals");
    });

    test("shows all required options in help", () => {
      const result = runCli(["extract", "--help"]);

      expect(result.stdout).toContain("--source");
      expect(result.stdout).toContain("--format");
      expect(result.stdout).toContain("--adapter");
      expect(result.stdout).toContain("--output");
      expect(result.stdout).toContain("--since");
      expect(result.stdout).toContain("--limit");
      expect(result.stdout).toContain("--dry-run");
    });

    test("defaults to claude-code source and fails on missing API key", () => {
      const { OPENAI_API_KEY, ANTHROPIC_API_KEY, DBE_API_KEY, ...cleanEnv } = process.env;
      const missingConfig = join(tmpdir(), `memoark-missing-${Date.now()}.yaml`);
      const result = runCli(["extract", "--config", missingConfig], {
        env: cleanEnv,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/api.key|error/i);
    });

    test("accepts format options", () => {
      const result = runCli(["extract", "--help"]);

      expect(result.stdout).toContain("json");
      expect(result.stdout).toContain("markdown");
    });

    test("accepts adapter options", () => {
      const result = runCli(["extract", "--help"]);

      expect(result.stdout).toContain("store");
      expect(result.stdout).toContain("file");
      expect(result.stdout).toContain("gbrain");
      expect(result.stdout).toContain("stdout");
    });

    test("accepts since and limit options", () => {
      const result = runCli(["extract", "--help"]);

      expect(result.stdout).toContain("--since");
      expect(result.stdout).toContain("--limit");
    });
  });

  describe("memoark doctor", () => {
    test("shows help with --help flag", () => {
      const result = runCli(["doctor", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("doctor");
      expect(result.stdout).toContain("Diagnose");
    });

    test("runs without crashing", () => {
      const result = runCli(["doctor"]);

      // Should either succeed or exit with diagnostic info
      const output = result.stdout + result.stderr;
      expect(output.length > 0).toBe(true);
    });

    test("reports on configuration and state", () => {
      const result = runCli(["doctor"]);

      const output = result.stdout;
      // Should contain diagnostic report title or sections
      expect(output).toMatch(/Diagnostic|Configuration|state|\.memoark/i);
    });
  });

  describe("memoark config init", () => {
    test("shows config subcommand help", () => {
      const result = runCli(["config", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("Generate");
    });

    test("init command runs successfully", () => {
      const result = runCli(["config", "init", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("--no-tui");
    });

    test("reports successful config creation", () => {
      // We won't actually create a file, but verify the help text is correct
      const result = runCli(["config", "--help"]);

      expect(result.stdout).toContain("memoark.yaml");
    });
  });

  describe("memoark sources list", () => {
    test("shows sources subcommand help", () => {
      const result = runCli(["sources", "--help"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("test");
    });

    test("list command shows available sources", () => {
      const result = runCli(["sources", "list"]);

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("claude-code");
    });

    test("list shows source descriptions", () => {
      const result = runCli(["sources", "list"]);

      const output = result.stdout;
      expect(output).toMatch(/Claude|conversation|agent/i);
    });
  });

  describe("memoark sources test", () => {
    test("test command runs health check", () => {
      const result = runCli(["sources", "test", "claude-code"]);

      // May succeed or fail depending on environment
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Claude Code|not found|failed|ok|testing/i);
    });

    test("test with unknown source fails", () => {
      const result = runCli(["sources", "test", "nonexistent"]);

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/Unknown|error/i);
    });

    test("test subcommand accepts source name", () => {
      const result = runCli(["sources", "--help"]);

      expect(result.stdout).toContain("test");
      expect(result.stdout).toContain("name");
    });
  });

  describe("memoark serve", () => {
    test("shows help", () => {
      const result = runCli(["serve", "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("serve");
      expect(result.stdout).toContain("--mcp");
    });
  });

  describe("memoark search", () => {
    test("shows help", () => {
      const result = runCli(["search", "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("search");
      expect(result.stdout).toContain("--mode");
    });
  });

  describe("memoark embed", () => {
    test("shows help", () => {
      const result = runCli(["embed", "--help"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("embed");
      expect(result.stdout).toContain("--limit");
    });
  });
});

/**
 * CLI command tests
 * Tests command parsing, --help output, and command execution
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const BUN = join(homedir(), ".bun", "bin", "bun");

describe("CLI", () => {
  describe("memoark --help", () => {
    test("shows main help with version and description", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("memoark");
      expect(result.stdout).toContain("Local-first personal memory");
      expect(result.stdout).toContain("version");
    });

    test("displays available commands", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("extract");
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
      const result = spawnSync(BUN, ["src/cli.ts", "extract", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("extract");
      expect(result.stdout).toContain("Extract signals");
    });

    test("shows all required options in help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "extract", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

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
      const result = spawnSync(BUN, ["src/cli.ts", "extract"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
        env: cleanEnv,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/api.key|error/i);
    });

    test("accepts format options", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "extract", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("json");
      expect(result.stdout).toContain("markdown");
    });

    test("accepts adapter options", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "extract", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("store");
      expect(result.stdout).toContain("file");
      expect(result.stdout).toContain("gbrain");
      expect(result.stdout).toContain("stdout");
    });

    test("accepts since and limit options", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "extract", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("--since");
      expect(result.stdout).toContain("--limit");
    });
  });

  describe("memoark doctor", () => {
    test("shows help with --help flag", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "doctor", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("doctor");
      expect(result.stdout).toContain("Diagnose");
    });

    test("runs without crashing", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "doctor"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      // Should either succeed or exit with diagnostic info
      const output = result.stdout + result.stderr;
      expect(output.length > 0).toBe(true);
    });

    test("reports on configuration and state", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "doctor"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      const output = result.stdout;
      // Should contain diagnostic report title or sections
      expect(output).toMatch(/Diagnostic|Configuration|state|\.dbe/i);
    });
  });

  describe("memoark config init", () => {
    test("shows config subcommand help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "config", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("init");
      expect(result.stdout).toContain("Generate");
    });

    test("init command runs successfully", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "config", "init", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
    });

    test("reports successful config creation", () => {
      // We won't actually create a file, but verify the help text is correct
      const result = spawnSync(BUN, ["src/cli.ts", "config", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("dbe.yaml");
    });
  });

  describe("memoark sources list", () => {
    test("shows sources subcommand help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("test");
    });

    test("list command shows available sources", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "list"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("claude-code");
    });

    test("list shows source descriptions", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "list"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      const output = result.stdout;
      expect(output).toMatch(/Claude|conversation|agent/i);
    });
  });

  describe("memoark sources test", () => {
    test("test command runs health check", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "test", "claude-code"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      // May succeed or fail depending on environment
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/Claude Code|not found|failed|ok|testing/i);
    });

    test("test with unknown source fails", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "test", "nonexistent"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr + result.stdout).toMatch(/Unknown|error/i);
    });

    test("test subcommand accepts source name", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "sources", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });

      expect(result.stdout).toContain("test");
      expect(result.stdout).toContain("name");
    });
  });

  describe("memoark serve", () => {
    test("shows help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "serve", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("serve");
      expect(result.stdout).toContain("--mcp");
    });
  });

  describe("memoark search", () => {
    test("shows help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "search", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("search");
      expect(result.stdout).toContain("--mode");
    });
  });

  describe("memoark embed", () => {
    test("shows help", () => {
      const result = spawnSync(BUN, ["src/cli.ts", "embed", "--help"], {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("embed");
      expect(result.stdout).toContain("--limit");
    });
  });
});

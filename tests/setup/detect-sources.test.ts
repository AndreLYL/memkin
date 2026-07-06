import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectSources } from "../../src/setup/detect-sources.js";

describe("detect sources", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "memkin-sources-"));
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
  });

  it("detects known agent session directories", () => {
    const claudeDir = join(homeDir, ".claude", "projects", "project-a");
    const codexDir = join(homeDir, ".codex", "sessions", "2026", "05");
    const hermesDir = join(homeDir, ".openclaw", "agents", "main", "sessions");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    mkdirSync(hermesDir, { recursive: true });
    writeFileSync(join(claudeDir, "session.jsonl"), "{}\n");
    writeFileSync(join(codexDir, "rollout.jsonl"), "{}\n");
    writeFileSync(join(hermesDir, "session-001.jsonl"), "{}\n");

    const sources = detectSources({ homeDir });

    expect(sources.map((source) => [source.id, source.detected])).toEqual([
      ["claude-code", true],
      ["codex", true],
      ["hermes", true],
    ]);
  });

  it("reports existing directories without sessions", () => {
    mkdirSync(join(homeDir, ".codex"), { recursive: true });

    const codex = detectSources({ homeDir }).find((source) => source.id === "codex");

    expect(codex?.detected).toBe(false);
    expect(codex?.message).toBe("Directory exists but no sessions");
  });
});

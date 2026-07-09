// src/core/legacy-retirement.test.ts
//
// Task 6.4 — legacy agent-extraction retirement (extraction-quality-redesign
// PR-6, spec §3.1, §11). Once an agent source is flipped off legacy
// (agent_pipeline = shadow | new), its legacy block-extraction path is retired:
//   - `isLegacyExtractionRetired` reports true, so the scheduler skips runPipeline
//     for that source (the new engine handles it);
//   - legacy is the DEFAULT, so merging PR-6 retires nothing until an operator
//     deliberately flips the flag (no auto-cutover, spec §3.1);
//   - fragment sources (feishu) are never retired — they keep the block pipeline;
//   - the legacy per-source string cursor is fully retired for agent collectors
//     (PR-0 groundwork): agent messages carry no `metadata.cursor` and the
//     collectors are not CursorProviders, so runPipeline commits no cursor.

import { describe, expect, it } from "vitest";
import {
  createClaudeCodeCollector,
  createCodexCollector,
  createHermesCollector,
} from "../collectors/index.js";
import type { Config } from "./config.js";
import { isLegacyExtractionRetired } from "./pipeline.js";

function configWith(sources: Record<string, unknown>): Config {
  return { sources } as unknown as Config;
}

describe("isLegacyExtractionRetired — flag-gated retirement", () => {
  it("does NOT retire an agent source on the default (legacy) mode", () => {
    const config = configWith({ "claude-code": { enabled: true } });
    expect(isLegacyExtractionRetired(config, "claude-code")).toBe(false);
  });

  it("retires legacy extraction for agent sources in shadow or new mode", () => {
    const config = configWith({
      "claude-code": { enabled: true, agent_pipeline: "shadow" },
      codex: { enabled: true, agent_pipeline: "new" },
    });
    expect(isLegacyExtractionRetired(config, "claude-code")).toBe(true);
    expect(isLegacyExtractionRetired(config, "codex")).toBe(true);
  });

  it("never retires fragment sources (feishu keeps the block pipeline)", () => {
    const config = configWith({ feishu: { agent_pipeline: "new" } });
    expect(isLegacyExtractionRetired(config, "feishu")).toBe(false);
    expect(isLegacyExtractionRetired(config, "feishu.docs")).toBe(false);
  });
});

describe("agent collectors — legacy cursor fully retired", () => {
  const collectors = [
    ["claude-code", createClaudeCodeCollector()],
    ["codex", createCodexCollector()],
    ["hermes", createHermesCollector()],
  ] as const;

  it("are not CursorProviders (no structured checkpoint path)", () => {
    for (const [, collector] of collectors) {
      expect("getCommittableCursors" in collector).toBe(false);
    }
  });

  it("expose the expected agent source ids", () => {
    expect(collectors.map(([, c]) => c.id)).toEqual(["claude-code", "codex", "hermes"]);
  });
});

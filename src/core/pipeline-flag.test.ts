// src/core/pipeline-flag.test.ts
//
// Task 6.1 — per-source agent_pipeline flag routing (extraction-quality-redesign
// PR-6, spec §3.1). The flag selects, per agent source, which apply path runs:
//   legacy → the current block-extraction runPipeline (writes production directly)
//   shadow → PR-4 apply engine with target=staging (physically isolated)
//   new    → PR-4 apply engine with target=production (post-cutover)
//
// Default is `legacy` so merging PR-6 never auto-flips production — cutover is a
// deliberate config change (spec §3.1, R3-3/R3-4).

import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { AGENT_SOURCE_IDS, isAgentSource, resolveAgentPipelineMode } from "./config.js";
import { type AgentPipelineHandlers, routeAgentPipeline } from "./pipeline.js";

function configWith(sources: Record<string, unknown>): Config {
  return { sources } as unknown as Config;
}

describe("resolveAgentPipelineMode — per-source flag", () => {
  it("defaults to legacy when the source has no agent_pipeline set", () => {
    const config = configWith({ "claude-code": { enabled: true } });
    expect(resolveAgentPipelineMode(config, "claude-code")).toBe("legacy");
  });

  it("defaults to legacy when the source is absent entirely", () => {
    expect(resolveAgentPipelineMode(configWith({}), "codex")).toBe("legacy");
  });

  it("returns the configured mode for each agent source", () => {
    const config = configWith({
      "claude-code": { enabled: true, agent_pipeline: "shadow" },
      codex: { enabled: true, agent_pipeline: "new" },
      hermes: { enabled: true, agent_pipeline: "legacy" },
    });
    expect(resolveAgentPipelineMode(config, "claude-code")).toBe("shadow");
    expect(resolveAgentPipelineMode(config, "codex")).toBe("new");
    expect(resolveAgentPipelineMode(config, "hermes")).toBe("legacy");
  });

  it("forces legacy for non-agent (fragment) sources like feishu", () => {
    // feishu is a fragment source on the block pipeline (PR-5), never the agent
    // apply engine — even if a stray agent_pipeline slips into its config.
    const config = configWith({ feishu: { agent_pipeline: "new" } });
    expect(resolveAgentPipelineMode(config, "feishu")).toBe("legacy");
    expect(resolveAgentPipelineMode(config, "feishu.docs")).toBe("legacy");
  });

  it("recognizes exactly the three agent sources", () => {
    expect([...AGENT_SOURCE_IDS]).toEqual(["claude-code", "codex", "hermes"]);
    expect(isAgentSource("claude-code")).toBe(true);
    expect(isAgentSource("feishu")).toBe(false);
    expect(isAgentSource("unknown")).toBe(false);
  });
});

describe("routeAgentPipeline — dispatch by mode", () => {
  function handlers(log: string[]): AgentPipelineHandlers<string> {
    return {
      legacy: async () => {
        log.push("legacy");
        return "legacy";
      },
      shadow: async () => {
        log.push("shadow");
        return "shadow";
      },
      new: async () => {
        log.push("new");
        return "new";
      },
    };
  }

  it("routes legacy → legacy handler only", async () => {
    const log: string[] = [];
    const out = await routeAgentPipeline("legacy", handlers(log));
    expect(out).toBe("legacy");
    expect(log).toEqual(["legacy"]);
  });

  it("routes shadow → shadow handler only", async () => {
    const log: string[] = [];
    const out = await routeAgentPipeline("shadow", handlers(log));
    expect(out).toBe("shadow");
    expect(log).toEqual(["shadow"]);
  });

  it("routes new → new handler only", async () => {
    const log: string[] = [];
    const out = await routeAgentPipeline("new", handlers(log));
    expect(out).toBe("new");
    expect(log).toEqual(["new"]);
  });
});

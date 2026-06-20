import { describe, expect, it } from "vitest";
import { runtimeSignature } from "./reload-manager.js";

const cfg = (over: Record<string, unknown> = {}) =>
  ({
    llm: { provider: "openai", model: "gpt-4o", api_key: "sk-a" },
    embedding: { provider: "openai", model: "e", api_key: "sk-b" },
    sources: { feishu: { enabled: true, app_secret: "s1", sources: { dm: { enabled: true } } } },
    privacy: { mask: true },
    block_builder: { block_gap_minutes: 30 },
    scheduler: { enabled: true, tick_interval_secs: 60, defaults: { interval_secs: 3600 }, sources: { feishu: { interval_secs: 900 } } },
    ...over,
  }) as never;

describe("runtimeSignature", () => {
  it("is stable when only scheduler fields change (→ Tier 1)", () => {
    const a = runtimeSignature(cfg());
    const b = runtimeSignature(cfg({ scheduler: { enabled: true, tick_interval_secs: 60, defaults: { interval_secs: 3600 }, sources: { feishu: { interval_secs: 300 } } } }));
    expect(a).toBe(b);
  });

  it("changes when llm.api_key changes (→ Tier 2)", () => {
    const a = runtimeSignature(cfg());
    const b = runtimeSignature(cfg({ llm: { provider: "openai", model: "gpt-4o", api_key: "sk-CHANGED" } }));
    expect(a).not.toBe(b);
  });

  it("changes when feishu app_secret changes (→ Tier 2)", () => {
    const a = runtimeSignature(cfg());
    const b = runtimeSignature(cfg({ sources: { feishu: { enabled: true, app_secret: "s2", sources: { dm: { enabled: true } } } } }));
    expect(a).not.toBe(b);
  });
});

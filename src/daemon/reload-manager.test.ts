import { describe, expect, it } from "vitest";
import { runtimeSignature, ReloadManager } from "./reload-manager.js";
import { ServeRuntimeHolder, type ServeRuntime } from "./serve-runtime.js";

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

function makeRuntime(onReconcile: (n: number) => void, label: string): ServeRuntime {
  let disposed = false;
  return {
    scheduler: {
      reconcile: () => onReconcile(1),
      drain: async () => {},
      start: async () => {},
    } as never,
    chatNameRefreshJob: undefined,
    getDaemonStatus: () => undefined,
    dispose: async () => { disposed = true; void disposed; void label; },
  };
}

// Fixtures: sameSig* differ ONLY in scheduler.sources (same signature → Tier 1).
// tier2* differ in llm.api_key (different signature → Tier 2).
const baseSigConfig = {
  llm: { provider: "openai", model: "gpt-4o", api_key: "sk-a" },
  embedding: { provider: "openai", model: "e", api_key: "sk-b" },
  sources: { feishu: { enabled: true, app_secret: "s1" } },
  privacy: {}, block_builder: { block_gap_minutes: 30 },
  scheduler: { enabled: true, tick_interval_secs: 60, defaults: { interval_secs: 3600 }, sources: { feishu: { interval_secs: 900 } } },
} as never;
const sameSigConfig = baseSigConfig;
const sameSigConfig2 = { ...(baseSigConfig as Record<string, unknown>), scheduler: { enabled: true, tick_interval_secs: 60, defaults: { interval_secs: 3600 }, sources: { feishu: { interval_secs: 300 } } } } as never;
const tier2Config = { ...(baseSigConfig as Record<string, unknown>), llm: { provider: "openai", model: "gpt-4o", api_key: "sk-CHANGED" } } as never;
const tier2ConfigB = { ...(baseSigConfig as Record<string, unknown>), llm: { provider: "openai", model: "gpt-4o", api_key: "sk-CHANGED-2" } } as never;

describe("ReloadManager", () => {
  it("Tier 1: same signature → calls scheduler.reconcile, no rebuild", async () => {
    let reconciled = 0;
    const holder = new ServeRuntimeHolder(makeRuntime(() => reconciled++, "init"));
    let rebuilds = 0;
    const mgr = new ReloadManager({
      holder,
      currentConfig: () => sameSigConfig,
      buildRuntime: async () => { rebuilds++; return makeRuntime(() => {}, "rebuilt"); },
    });
    await mgr.run(sameSigConfig2);
    expect(reconciled).toBe(1);
    expect(rebuilds).toBe(0);
  });

  it("Tier 2: signature change → drain + rebuild + swap + dispose old", async () => {
    const drained: string[] = [];
    const holder = new ServeRuntimeHolder({
      ...makeRuntime(() => {}, "old"),
      scheduler: { reconcile: () => {}, drain: async () => { drained.push("old"); }, start: async () => {} } as never,
    });
    let rebuilds = 0;
    const mgr = new ReloadManager({
      holder,
      currentConfig: () => baseSigConfig,
      buildRuntime: async () => { rebuilds++; return makeRuntime(() => {}, "new"); },
    });
    await mgr.run(tier2Config);
    expect(drained).toEqual(["old"]);
    expect(rebuilds).toBe(1);
  });

  it("serializes concurrent runs (single-flight)", async () => {
    const order: string[] = [];
    const holder = new ServeRuntimeHolder(makeRuntime(() => {}, "init"));
    const mgr = new ReloadManager({
      holder,
      currentConfig: () => baseSigConfig,
      buildRuntime: async () => { order.push("build-start"); await new Promise((r) => setTimeout(r, 10)); order.push("build-end"); return makeRuntime(() => {}, "n"); },
    });
    await Promise.all([mgr.run(tier2Config), mgr.run(tier2ConfigB)]);
    expect(order).toEqual(["build-start", "build-end", "build-start", "build-end"]);
  });
});

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

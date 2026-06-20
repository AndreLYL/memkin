import type { Config } from "../core/config.js";
import type { ServeRuntime, ServeRuntimeHolder } from "./serve-runtime.js";

/**
 * Stable signature over the Tier-2-relevant config subset.
 * Same signature → scheduling-only change → Tier 1 reconcile.
 * Different signature → credential/pipeline change → Tier 2 rebuild.
 * Deliberately EXCLUDES the scheduler section (Tier 1's domain).
 */
export function runtimeSignature(config: Config): string {
  const subset = {
    llm: config.llm,
    embedding: config.embedding,
    privacy: config.privacy,
    block_builder: config.block_builder,
    pipeline: config.pipeline ?? null,
    sources: config.sources,
  };
  return JSON.stringify(subset);
}

export interface ReloadDeps {
  holder: ServeRuntimeHolder;
  /** Returns the config currently in effect (pre-reload), for signature comparison. */
  currentConfig: () => Config;
  /** Build a brand-new runtime from a new config (= buildServeRuntime bound to stores/stateDir). */
  buildRuntime: (config: Config) => Promise<ServeRuntime>;
}

export class ReloadManager {
  private running = false;
  private queued: Config | null = null;
  private lastConfig: Config;

  constructor(private deps: ReloadDeps) {
    this.lastConfig = deps.currentConfig();
  }

  /** single-flight: if a run is in progress, the latest config is queued and applied after. */
  async run(config: Config): Promise<void> {
    if (this.running) {
      this.queued = config;
      return;
    }
    this.running = true;
    try {
      await this.apply(config);
      while (this.queued) {
        const next = this.queued;
        this.queued = null;
        await this.apply(next);
      }
    } finally {
      this.running = false;
    }
  }

  private async apply(config: Config): Promise<void> {
    const prevSig = runtimeSignature(this.lastConfig);
    const nextSig = runtimeSignature(config);
    if (prevSig === nextSig) {
      // Tier 1: scheduling-only change
      if (config.scheduler) this.deps.holder.current.scheduler?.reconcile(config.scheduler);
    } else {
      // Tier 2: build FIRST (failure leaves old untouched), then drain old → swap → start new → dispose old.
      const next = await this.deps.buildRuntime(config); // throws → old runtime untouched, error bubbles
      const old = this.deps.holder.current;
      await old.scheduler?.drain();
      this.deps.holder.swap(next);
      if (config.scheduler?.enabled) await next.scheduler?.start();
      await old.dispose();
    }
    this.lastConfig = config;
  }
}

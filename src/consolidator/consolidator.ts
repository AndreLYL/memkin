import type { LLMProvider } from "../extractors/providers/types.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";
import { consolidateHotToWarm } from "./hot-warm.js";

export interface ConsolidatorStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
}

export interface ConsolidateResult {
  hotToWarm: number;
  warmToCold: number;
  deadLinksChecked: number;
  preferencesInferred: number;
}

export type ConsolidateMode = "hot" | "warm" | "all";

export class Consolidator {
  private hotTimer: ReturnType<typeof setInterval> | null = null;
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stores: ConsolidatorStores,
    private llm?: LLMProvider,
  ) {
    // These will be used in Tasks 4-5
    void this.stores;
    void this.llm;
  }

  start(): void {
    this.hotTimer = setInterval(() => void this.consolidateHot(), 86_400_000);
    this.warmTimer = setInterval(() => void this.consolidateWarm(), 7 * 86_400_000);
  }

  stop(): void {
    if (this.hotTimer) clearInterval(this.hotTimer);
    if (this.warmTimer) clearInterval(this.warmTimer);
    this.hotTimer = null;
    this.warmTimer = null;
  }

  async runOnce(mode: ConsolidateMode = "all", dryRun = false): Promise<ConsolidateResult> {
    const result: ConsolidateResult = {
      hotToWarm: 0,
      warmToCold: 0,
      deadLinksChecked: 0,
      preferencesInferred: 0,
    };
    if (mode === "hot" || mode === "all") {
      result.hotToWarm = await this.consolidateHot(dryRun);
    }
    if (mode === "warm" || mode === "all") {
      const warmResult = await this.consolidateWarm(dryRun);
      result.warmToCold = warmResult.warmToCold;
      result.deadLinksChecked = warmResult.deadLinksChecked;
      result.preferencesInferred = warmResult.preferencesInferred;
    }
    return result;
  }

  async consolidateHot(dryRun = false): Promise<number> {
    return consolidateHotToWarm(this.stores, dryRun);
  }

  async consolidateWarm(dryRun = false): Promise<Omit<ConsolidateResult, "hotToWarm">> {
    // Implemented in Task 5
    void dryRun;
    return { warmToCold: 0, deadLinksChecked: 0, preferencesInferred: 0 };
  }
}

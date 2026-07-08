import type { ProfileConfig } from "../core/config.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import { type ProfileSynthStores, synthesizeProfiles } from "../profile/profile-synth.js";
import type { DistilledPayloadStore } from "../store/distilled-payload.js";
import type { EntityMergeSuggestionStore } from "../store/entity-suggestions.js";
import type { GraphStore } from "../store/graph.js";
import type { PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineStore } from "../store/timeline.js";
import { checkDeadLinks } from "./dead-link.js";
import { sweepEntityMergeSuggestions } from "./entity-merge.js";
import { consolidateHotToWarm } from "./hot-warm.js";
import { inferPreferences } from "./infer-preferences.js";
import { consolidateWarmToCold } from "./warm-cold.js";

export interface ConsolidatorStores {
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
  /**
   * Optional entity merge suggestion aggregation (spec §9). When present, the
   * hot cycle sweeps entity pages for near-duplicates and records suggestions
   * for user review — never merges automatically.
   */
  entitySuggestions?: EntityMergeSuggestionStore;
}

/**
 * Optional person-communication-profile wiring (Spec 8). When provided AND
 * profile.enabled, consolidateWarm runs nightly profile synthesis.
 */
export interface ConsolidatorProfileOpts {
  profile: ProfileConfig;
  profileStores: ProfileSynthStores;
}

/**
 * Optional distilled-payload outbox wiring (extraction-quality-redesign PR-2,
 * spec §4.3). When provided, runOnce stamps ttl_expires_at for payloads of
 * `done` sessions (ttlDays, default distiller.payload_ttl_days = 90) and sweeps
 * payloads past their TTL — clearing the reversible restoration map with them.
 */
export interface ConsolidatorOutboxOpts {
  payloads: DistilledPayloadStore;
  ttlDays: number;
}

export interface ConsolidateResult {
  hotToWarm: number;
  warmToCold: number;
  deadLinksChecked: number;
  preferencesInferred: number;
  profilesSynthesized: number;
  entityMergeSuggestions: number;
  payloadsSwept: number;
}

export type ConsolidateMode = "hot" | "warm" | "all";

export class Consolidator {
  private hotTimer: ReturnType<typeof setInterval> | null = null;
  private warmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private stores: ConsolidatorStores,
    private llm?: LLMProvider,
    private profileOpts?: ConsolidatorProfileOpts,
    private outboxOpts?: ConsolidatorOutboxOpts,
  ) {}

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
      profilesSynthesized: 0,
      entityMergeSuggestions: 0,
      payloadsSwept: 0,
    };
    if (mode === "hot" || mode === "all") {
      result.hotToWarm = await this.consolidateHot(dryRun);
      // Spec §9: aggregate near-duplicate entity pages into merge suggestions.
      // Deterministic (no LLM), so it rides the daily hot cycle.
      if (this.stores.entitySuggestions) {
        result.entityMergeSuggestions = await sweepEntityMergeSuggestions(
          this.stores.entitySuggestions,
          dryRun,
        );
      }
      result.payloadsSwept = await this.sweepDistilledPayloads(dryRun);
    }
    if (mode === "warm" || mode === "all") {
      const warmResult = await this.consolidateWarm(dryRun);
      result.warmToCold = warmResult.warmToCold;
      result.deadLinksChecked = warmResult.deadLinksChecked;
      result.preferencesInferred = warmResult.preferencesInferred;
      result.profilesSynthesized = warmResult.profilesSynthesized;
    }
    return result;
  }

  async consolidateHot(dryRun = false): Promise<number> {
    return consolidateHotToWarm(this.stores, dryRun);
  }

  /**
   * Distilled-payload TTL cleanup (spec §4.3): stamp TTLs for payloads whose
   * session reached `done`, then delete payloads past their TTL. No-op when the
   * outbox is not wired or in dry-run mode.
   */
  private async sweepDistilledPayloads(dryRun: boolean): Promise<number> {
    if (!this.outboxOpts || dryRun) return 0;
    await this.outboxOpts.payloads.stampTtlForDoneSessions(this.outboxOpts.ttlDays);
    return this.outboxOpts.payloads.sweepExpired();
  }

  async consolidateWarm(
    dryRun = false,
  ): Promise<Omit<ConsolidateResult, "hotToWarm" | "entityMergeSuggestions" | "payloadsSwept">> {
    if (!this.llm) {
      throw new Error("LLM provider required for warm→cold consolidation");
    }
    const { warmToCold } = await consolidateWarmToCold(this.stores, this.llm, dryRun);
    const deadLinksChecked = dryRun ? 0 : await checkDeadLinks(this.stores.pages);
    const preferencesInferred = dryRun ? 0 : await inferPreferences(this.stores, this.llm);

    // Spec 8: nightly profile synthesis (trait + relation layers), gated by config.
    let profilesSynthesized = 0;
    if (!dryRun && this.profileOpts?.profile.enabled) {
      profilesSynthesized = await synthesizeProfiles(
        this.profileOpts.profileStores,
        this.llm,
        this.profileOpts.profile,
      );
    }

    return { warmToCold, deadLinksChecked, preferencesInferred, profilesSynthesized };
  }
}

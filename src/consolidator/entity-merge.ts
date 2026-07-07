/**
 * Entity merge suggestion sweep (extraction-quality-redesign PR-3, spec §9).
 *
 * Scans entity pages for near-duplicates and produces merge SUGGESTIONS only —
 * auto-merge is forbidden by the identity contract. Detectors:
 *
 *   - same_name:    multiple pages of the same type share the exact title
 *                   (absorbed from the ad-hoc scripts/check-dupes.ts probe)
 *   - levenshtein:  same-type titles within a small edit distance
 *   - pinyin:       person titles whose pinyin canonicalization collides
 *                   (王建都 vs 王健都 → person/wang-jiandu)
 *
 * The consolidator aggregates candidates into entity_merge_suggestions; the
 * user confirms, then merges run through the explicit merge machinery.
 */

import type { EntityHandleType } from "../core/person-identity.js";
import { toPersonCanonicalSlug } from "../core/person-slug.js";
import type {
  EntityMergeSuggestionStore,
  EntityPageRef,
  MergeSuggestionCandidate,
} from "../store/entity-suggestions.js";

const ENTITY_PAGE_TYPES = ["person", "project", "organization", "tool", "concept"] as const;

/** Minimum title length considered for fuzzy (Levenshtein) comparison. */
const MIN_FUZZY_TITLE_LEN = 4;

function levenshteinThreshold(aLen: number, bLen: number): number {
  return Math.min(aLen, bLen) >= 8 ? 2 : 1;
}

/**
 * Banded Levenshtein distance with early exit: returns Infinity as soon as the
 * distance provably exceeds `max`.
 */
export function boundedLevenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Number.POSITIVE_INFINITY;
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return Number.POSITIVE_INFINITY;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length] <= max ? prev[b.length] : Number.POSITIVE_INFINITY;
}

/**
 * Pure detection over a snapshot of entity pages. Deterministic ordering:
 * within a duplicate pair, `into_slug` is the lexicographically first slug.
 */
export function detectEntityMergeCandidates(pages: EntityPageRef[]): MergeSuggestionCandidate[] {
  const candidates: MergeSuggestionCandidate[] = [];
  const seenPairs = new Set<string>();

  const suggest = (
    entityType: EntityHandleType,
    slugA: string,
    slugB: string,
    reason: MergeSuggestionCandidate["reason"],
    detail?: Record<string, unknown>,
  ) => {
    const [into, from] = [slugA, slugB].sort();
    const pairKey = `${entityType}|${into}|${from}`;
    if (seenPairs.has(pairKey)) return;
    seenPairs.add(pairKey);
    candidates.push({ entity_type: entityType, from_slug: from, into_slug: into, reason, detail });
  };

  const byType = new Map<string, EntityPageRef[]>();
  for (const p of pages) {
    if (!(ENTITY_PAGE_TYPES as readonly string[]).includes(p.type)) continue;
    const group = byType.get(p.type) ?? [];
    group.push(p);
    byType.set(p.type, group);
  }

  for (const [type, group] of byType) {
    const entityType = type as EntityHandleType;

    // 1. same_name — exact title groups (check-dupes logic).
    const byTitle = new Map<string, EntityPageRef[]>();
    for (const p of group) {
      const list = byTitle.get(p.title) ?? [];
      list.push(p);
      byTitle.set(p.title, list);
    }
    for (const [title, dupes] of byTitle) {
      if (dupes.length < 2) continue;
      const sorted = dupes.map((d) => d.slug).sort();
      for (let i = 1; i < sorted.length; i++) {
        suggest(entityType, sorted[0], sorted[i], "same_name", { name: title });
      }
    }

    // 2. levenshtein — near-identical titles within the same type.
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (a.title.length < MIN_FUZZY_TITLE_LEN) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (b.title.length < MIN_FUZZY_TITLE_LEN) continue;
        if (a.title === b.title) continue; // covered by same_name
        const max = levenshteinThreshold(a.title.length, b.title.length);
        const dist = boundedLevenshtein(a.title.toLowerCase(), b.title.toLowerCase(), max);
        if (dist <= max) {
          suggest(entityType, a.slug, b.slug, "levenshtein", {
            titles: [a.title, b.title],
            distance: dist,
          });
        }
      }
    }

    // 3. pinyin — person titles that canonicalize to the same pinyin slug.
    if (entityType === "person") {
      const byPinyin = new Map<string, EntityPageRef[]>();
      for (const p of group) {
        const pin = toPersonCanonicalSlug(p.title);
        if (!pin) continue;
        const list = byPinyin.get(pin) ?? [];
        list.push(p);
        byPinyin.set(pin, list);
      }
      for (const [pin, dupes] of byPinyin) {
        if (dupes.length < 2) continue;
        const sorted = dupes.map((d) => d.slug).sort();
        for (let i = 1; i < sorted.length; i++) {
          suggest(entityType, sorted[0], sorted[i], "pinyin", { pinyin_slug: pin });
        }
      }
    }
  }

  return candidates;
}

/**
 * Sweep the store's entity pages, aggregate merge candidates into
 * entity_merge_suggestions, and return how many candidates were detected.
 * Dry run detects without writing.
 */
export async function sweepEntityMergeSuggestions(
  suggestions: EntityMergeSuggestionStore,
  dryRun = false,
): Promise<number> {
  const pages = await suggestions.listEntityPages();
  const candidates = detectEntityMergeCandidates(pages);
  if (!dryRun) {
    for (const c of candidates) {
      await suggestions.record(c);
    }
  }
  return candidates.length;
}

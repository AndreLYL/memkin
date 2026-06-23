import { createHash } from "node:crypto";
import type { StoreContext } from "../server/api.js";
import type { AssembledCandidate, SynthesisResult, SynthScope } from "./types.js";

/** Cache entry shape stored under frontmatter.synth[intent]. */
interface CacheEntry {
  input_hash: string;
  generated_at: string;
  result: SynthesisResult;
}

/** input_hash = stable hash of the candidate (slug, date) set (Spec 7 §九 freshness). */
export function computeInputHash(candidates: AssembledCandidate[]): string {
  const key = candidates
    .map((c) => `${c.slug}:${c.date ?? ""}`)
    .sort()
    .join("|");
  return createHash("sha256").update(key).digest("hex");
}

/** Page slug carrying the cache for a given scope, or null for non-cacheable (query) scopes. */
function cacheCarrierSlug(intent: string, scope: SynthScope): string | null {
  if (scope.entity) return scope.entity;
  if (scope.time) return `reports/${intent}/${scope.time.from}..${scope.time.to}`;
  return null; // query scope → not cached (Spec 7 §九)
}

/**
 * Read a cached synthesis result for a scope, returning it only when fresh
 * (stored input_hash matches the current one). Returns null on miss/staleness/query-scope.
 */
export async function read(
  intent: string,
  scope: SynthScope,
  inputHash: string,
  stores: StoreContext,
): Promise<SynthesisResult | null> {
  const slug = cacheCarrierSlug(intent, scope);
  if (!slug) return null;

  const page = await stores.pages.getPage(slug);
  if (!page) return null;

  const synth = page.frontmatter.synth as Record<string, CacheEntry> | undefined;
  const entry = synth?.[intent];
  if (!entry || entry.input_hash !== inputHash) return null;

  return { ...entry.result, meta: { ...entry.result.meta, cached: true } };
}

/**
 * Write a synthesis result into its scope's cache carrier page.
 * - entity scope → entity page frontmatter.synth[intent]
 * - time scope   → reports/<intent>/<from..to> knowledge page (frontmatter.is_report=true)
 * - query scope  → no-op (not cached)
 */
export async function write(
  intent: string,
  scope: SynthScope,
  result: SynthesisResult,
  inputHash: string,
  stores: StoreContext,
): Promise<void> {
  const slug = cacheCarrierSlug(intent, scope);
  if (!slug) return;

  const entry: CacheEntry = {
    input_hash: inputHash,
    generated_at: result.meta.generated_at,
    result,
  };

  const isReport = Boolean(scope.time);
  const existing = await stores.pages.getPage(slug);

  if (!existing) {
    // Entity scope: never create a phantom entity page just to cache a synthesis.
    if (!isReport) return;
    // Report (time) scope: create the dedicated report page once.
    await stores.pages.putPage(
      slug,
      `---\ntitle: ${intent} report ${slug}\ntype: knowledge\nis_report: true\n---\n`,
    );
  }

  await stores.pages.setSynthCache(slug, intent, entry);
}

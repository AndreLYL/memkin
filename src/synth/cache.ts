import { createHash } from "node:crypto";
import { stringify as stringifyYaml } from "yaml";
import type { StoreContext } from "../server/api.js";
import type { Page } from "../store/pages.js";
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

function serializePage(
  title: string,
  type: string,
  frontmatter: Record<string, unknown>,
  body: string,
): string {
  const { title: _t, type: _ty, ...rest } = frontmatter;
  const fm: Record<string, unknown> = { title, type, ...rest };
  return `---\n${stringifyYaml(fm)}---\n${body}`;
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

  const existing: Page | null = await stores.pages.getPage(slug);
  const isReport = Boolean(scope.time);

  const title = existing?.title ?? (isReport ? `${intent} report ${slug}` : slug);
  const type = existing?.type ?? (isReport ? "knowledge" : "entity");
  const body = existing?.compiled_truth ?? "";

  const frontmatter: Record<string, unknown> = { ...(existing?.frontmatter ?? {}) };
  if (isReport) frontmatter.is_report = true;
  const synth = (frontmatter.synth as Record<string, CacheEntry> | undefined) ?? {};
  synth[intent] = entry;
  frontmatter.synth = synth;

  const content = serializePage(title, type, frontmatter, body);
  const page = await stores.pages.putPage(slug, content);
  if (page.compiled_truth.trim()) {
    await stores.chunks.rechunk(page.id, page.compiled_truth);
  }
}

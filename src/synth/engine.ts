import type { ChatMessage, LLMProvider } from "../extractors/providers/types.js";
import type { StoreContext } from "../server/api.js";
import * as cache from "./cache.js";
import { finalize } from "./citations.js";
import { assemble } from "./context.js";
import { getIntent } from "./intent.js";
import { retrieve } from "./scope.js";
// Trigger explicit intent registration before any synthesize() call.
import "./intents/index.js";
import type {
  AssembledContext,
  ComposeOutput,
  Gap,
  IntentTemplate,
  SynthesisResult,
  SynthOpts,
  SynthScope,
} from "./types.js";

export interface SynthDeps {
  stores: StoreContext;
  provider: LLMProvider;
  /** Model id to record in meta (the provider itself is already configured). */
  model?: string;
}

function renderCandidates(ctx: AssembledContext): string {
  return ctx.candidates
    .map((c) => `[${c.ref}] ${c.title}${c.date ? ` (${c.date})` : ""}\n${c.text}`)
    .join("\n\n");
}

function buildMessages(
  intent: IntentTemplate,
  ctx: AssembledContext,
  extra?: Record<string, unknown>,
): ChatMessage[] {
  const parts: string[] = [];
  if (ctx.pinnedContext) parts.push(ctx.pinnedContext);
  parts.push(renderCandidates(ctx));
  if (extra && Object.keys(extra).length > 0) {
    parts.push(`补充参数：${JSON.stringify(extra)}`);
  }
  return [
    { role: "system", content: intent.systemPrompt },
    { role: "user", content: parts.join("\n\n") },
  ];
}

async function compose(
  intent: IntentTemplate,
  ctx: AssembledContext,
  provider: LLMProvider,
  extra?: Record<string, unknown>,
): Promise<ComposeOutput> {
  const answer = await provider.chat(buildMessages(intent, ctx, extra));
  return { answer };
}

function runGaps(intent: IntentTemplate, ctx: AssembledContext, raw: ComposeOutput): Gap[] {
  const gaps: Gap[] = [];
  for (const rule of intent.gapRules) {
    gaps.push(...rule.evaluate(ctx, raw, intent));
  }
  return gaps;
}

/**
 * Synthesis engine entry point (Spec 7 §3.3 eight-step flow).
 * The engine calls optional intent hooks generically; it never imports a concrete intent.
 */
export async function synthesize(
  intentId: string,
  scope: SynthScope,
  deps: SynthDeps,
  opts?: SynthOpts,
): Promise<SynthesisResult> {
  // 1. resolve intent
  const intent = getIntent(intentId);
  const { stores, provider } = deps;

  // 3. retrieve candidates (best-chunk pooling enabled inside scope retrieval)
  const rawCandidates = await retrieve(scope, { poolByPage: true }, stores);

  // 4. optional hook: re-rank candidates
  let raw = rawCandidates;
  if (intent.sortCandidates) {
    const numbered = raw.map((c, i) => ({ ...c, ref: i + 1 }));
    const sorted = await intent.sortCandidates(numbered, stores);
    raw = sorted.map(({ ref: _ref, ...rest }) => rest);
  }

  // 5. assemble numbered context
  const ctx = assemble(scope, raw);

  // compute freshness hash now that candidates are known
  const inputHash = cache.computeInputHash(ctx.candidates);

  // 2. cache read (after retrieval so input_hash freshness can be validated)
  if (!opts?.noCache) {
    const hit = await cache.read(intentId, scope, inputHash, stores);
    if (hit) return hit;
  }

  // 6. optional hook: build non-citable pinned context
  if (intent.buildPinnedContext) {
    ctx.pinnedContext = await intent.buildPinnedContext(scope, stores);
  }

  // 7. compose via LLM
  const composed = await compose(intent, ctx, provider, opts?.extra);

  // 8. finalize citations + gaps + cache write
  const { answer, citations } = finalize(composed.answer, ctx.candidates);
  const gaps = runGaps(intent, ctx, composed);

  let sections: SynthesisResult["sections"];
  if (intent.format === "sections" && intent.parseSections) {
    sections = intent.parseSections(answer);
  }

  const result: SynthesisResult = {
    intent: intentId,
    answer,
    sections,
    citations,
    gaps,
    meta: {
      model: deps.model ?? "unknown",
      generated_at: new Date().toISOString(),
      scope,
      cached: false,
    },
  };

  if (!opts?.noCache) {
    await cache.write(intentId, scope, result, inputHash, stores);
  }

  return result;
}

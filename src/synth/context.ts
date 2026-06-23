import type { RawCandidate } from "./scope.js";
import type { AssembledContext, SynthScope } from "./types.js";

/**
 * Assemble retrieved candidates into a numbered AssembledContext (Spec 7 §3.3 step 5).
 * Assigns ref=1..N (in order) and derives latestDate=max(date).
 * pinnedContext is left undefined; intents may set it via the buildPinnedContext hook.
 */
export function assemble(scope: SynthScope, candidates: RawCandidate[]): AssembledContext {
  const numbered = candidates.map((c, i) => ({ ...c, ref: i + 1 }));

  let latestDate: string | undefined;
  for (const c of numbered) {
    if (c.date && (!latestDate || c.date > latestDate)) {
      latestDate = c.date;
    }
  }

  return {
    scope,
    candidates: numbered,
    latestDate,
  };
}

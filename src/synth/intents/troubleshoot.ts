import { missingFieldRule } from "../gaps.js";
import type { AssembledCandidate, IntentTemplate } from "../types.js";

/**
 * Reorder `candidates` so that any slug present in `order` appears first, in the
 * order given; candidates not in `order` keep their relative order and trail behind.
 */
function reorderBy(candidates: AssembledCandidate[], order: string[]): AssembledCandidate[] {
  const rank = new Map<string, number>();
  order.forEach((slug, i) => {
    rank.set(slug, i);
  });
  const ranked: AssembledCandidate[] = [];
  const rest: AssembledCandidate[] = [];
  for (const c of candidates) {
    if (rank.has(c.slug)) ranked.push(c);
    else rest.push(c);
  }
  ranked.sort((a, b) => (rank.get(a.slug) ?? 0) - (rank.get(b.slug) ?? 0));
  return [...ranked, ...rest];
}

/**
 * Spec 11 §6: one-shot troubleshooting over playbook pages.
 *
 * Retrieval is scoped to `type=playbook`. Graph-edge ordering happens HERE (the
 * LLM cannot see edges): the `sortCandidates` hook walks the `precedes` chain via
 * `graph.getOrderedSequence` and pre-orders candidates before they are numbered.
 * The systemPrompt only asks the model to follow the given numbering.
 */
export const troubleshootIntent: IntentTemplate = {
  id: "troubleshoot",
  format: "single",
  staleDays: 0,
  // types:["playbook"] is passed through by scope.ts to search.ts's `p.type = ANY($n)` filter.
  buildScope: (args) => ({
    query: args.query as string,
    types: ["playbook"],
    limit: 10,
  }),
  systemPrompt:
    "你是排查助手。下面是按排查顺序排好的 playbook 片段。" +
    "请按片段给定的编号顺序组织排查步骤，并解释每步不同结果的含义。" +
    "用 [n] 标注来源 playbook。信息不足时直说。",
  expects: ["排查步骤"],
  gapRules: [missingFieldRule],
  // Graph-edge ordering at retrieval time; engine.ts calls this hook generically.
  // Candidates arrive ranked by relevance, not by graph order. We walk the `precedes`
  // chain from each candidate and adopt the longest chain that covers the most of them
  // (so the chain head, wherever it sits in the relevance ranking, anchors the order).
  async sortCandidates(candidates, stores) {
    if (candidates.length <= 1) return candidates;
    const slugSet = new Set(candidates.map((c) => c.slug));
    let best: string[] = [];
    for (const c of candidates) {
      const seq = (await stores.graph.getOrderedSequence(c.slug)).map((n) => n.slug);
      const coverage = seq.filter((s) => slugSet.has(s)).length;
      const bestCoverage = best.filter((s) => slugSet.has(s)).length;
      if (coverage > bestCoverage) best = seq;
    }
    if (best.length === 0) return candidates;
    return reorderBy(candidates, best);
  },
};

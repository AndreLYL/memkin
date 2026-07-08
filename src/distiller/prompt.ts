/**
 * Distillation prompt assembly (spec §5, §5.1, §11 task 2.9).
 *
 * The judgment-declaration criteria live in an embedded markdown prompt
 * (`src/extractors/prompts/distill.md`, inlined by gen:assets into PROMPTS).
 * This module wraps that criteria into the concrete map + reduce prompts, with
 * carry-forward and overturned instructions threaded in.
 *
 * Keeping prompt text out of map-reduce.ts lets the criteria be iterated
 * (PR-1 eval loop) without touching orchestration logic.
 */

import { PROMPTS } from "../embedded-assets.generated.js";
import type { SegmentSummary } from "./map-reduce.js";

/** Load the embedded distill criteria; falls back to a terse built-in if absent. */
export function getDistillCriteria(): string {
  return PROMPTS["distill.md"] ?? FALLBACK_CRITERIA;
}

const FALLBACK_CRITERIA = `You are distilling an agent session for a future retriever 30 days from now.
Record only what a colleague would need to reconstruct WHY things are the way they
are. Distinguish: the user deciding (user_confirmed) vs. you proposing
(assistant_proposed) vs. a claim proven by a tool result (assistant_claimed).
Skip transient debugging chatter and unconfirmed proposals.`;

export interface MapPromptInput {
  criteria?: string;
  segmentText: string;
  segNo: number;
  carryForward: string;
}

export function getMapPrompt(input: MapPromptInput): string {
  const criteria = input.criteria ?? getDistillCriteria();
  const carrySection =
    input.carryForward.trim().length > 0
      ? `\n## Carried forward from the previous segment\n\n${input.carryForward}\n`
      : "";
  return `${criteria}

## Segment ${input.segNo}
${carrySection}
## Messages

${input.segmentText}

## Instructions

Distill THIS segment only. Output ONLY JSON of shape:
{
  "seg_no": ${input.segNo},
  "summary": "<one-paragraph gist of this segment>",
  "tentative_signals": [ /* candidate signals per the contract */ ],
  "overturned": [ { "topic": "<a topic from earlier that is now retracted>", "reason": "..." } ],
  "carry_forward": "<in-progress topics / undecided items to hand to the next segment>"
}`;
}

export interface ReducePromptInput {
  criteria?: string;
  segmentSummaries: SegmentSummary[];
  overturnedTopics: string[];
}

export function getReducePrompt(input: ReducePromptInput): string {
  const criteria = input.criteria ?? getDistillCriteria();
  const summariesJson = JSON.stringify(input.segmentSummaries, null, 2);
  const overturnedList =
    input.overturnedTopics.length > 0
      ? input.overturnedTopics.map((t) => `- ${t}`).join("\n")
      : "(none)";
  return `${criteria}

## Segment summaries

${summariesJson}

## Overturned topics (MUST NOT appear in the final signals)

${overturnedList}

## Instructions

Merge the tentative signals across all segments into the final session payload.
RULE: any conclusion that appears in the overturned list above MUST NOT enter the
final signals. Deduplicate: no two final signals may share the same (type, topic).
Output ONLY JSON of shape { "signals": [ ...signals per the contract... ] }.`;
}

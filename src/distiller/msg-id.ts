/**
 * Programmatic msg_id assignment + evidence validation (spec §5.2).
 *
 * The pipeline — not the model — assigns each transcript message a sequential
 * `msg_id` (`msg-1`, `msg-2`, …). Oversized messages get sub-segment ids with a
 * dotted suffix (`msg-42.1`, `msg-42.2`; see segmenter.ts). The model may only
 * cite these given ids, and the validation layer here rejects any evidence range
 * that falls outside the assigned set — killing line-number / id hallucination.
 *
 * It also enforces the spec §5 rule that `reference.url` must be locatable inside
 * the text of its own evidence range: we pull the evidence text and check the url
 * appears as a substring, so the model cannot conjure a url out of thin air.
 *
 * Ordering note: ranges are resolved by INDEX into the ordered message list, not
 * by parsing the numeric id. This makes plain ids and dotted sub-segment ids
 * (`msg-42.1`) order uniformly without a bespoke comparator.
 */

import type { DistilledSignal } from "./contract.js";

export type MessageRole = "user" | "assistant";

export interface RawInputMessage {
  role: MessageRole;
  content: string;
}

export interface ParsedMessage {
  msgId: string;
  role: MessageRole;
  content: string;
}

/** Assign sequential `msg-N` ids to messages in order. */
export function assignMsgIds(messages: RawInputMessage[]): ParsedMessage[] {
  return messages.map((m, i) => ({
    msgId: `msg-${i + 1}`,
    role: m.role,
    content: m.content,
  }));
}

interface EvidenceRange {
  start: string;
  end: string;
}

function indexOfMsgId(parsed: ParsedMessage[], msgId: string): number {
  return parsed.findIndex((m) => m.msgId === msgId);
}

/**
 * Concatenate the text of every message in [start, end] (inclusive), resolved by
 * index. Throws if either bound is unknown or the range is inverted — callers
 * that want a boolean should go through validateEvidence.
 */
export function collectEvidenceText(parsed: ParsedMessage[], range: EvidenceRange): string {
  const s = indexOfMsgId(parsed, range.start);
  const e = indexOfMsgId(parsed, range.end);
  if (s < 0) throw new Error(`unknown evidence start id: ${range.start}`);
  if (e < 0) throw new Error(`unknown evidence end id: ${range.end}`);
  if (s > e) throw new Error(`inverted evidence range: ${range.start}..${range.end}`);
  return parsed
    .slice(s, e + 1)
    .map((m) => m.content)
    .join("\n");
}

export type ValidateEvidenceResult = { ok: true } | { ok: false; errors: string[] };

/**
 * Validate every signal's evidence against the assigned msg_id set:
 *  - both bounds must reference an assigned id;
 *  - the range must not be inverted;
 *  - for `reference` signals, the url must appear in the evidence text.
 */
export function validateEvidence(
  signals: DistilledSignal[],
  parsed: ParsedMessage[],
): ValidateEvidenceResult {
  const errors: string[] = [];

  for (const sig of signals) {
    for (const range of sig.evidence) {
      const s = indexOfMsgId(parsed, range.start);
      const e = indexOfMsgId(parsed, range.end);
      if (s < 0) {
        errors.push(`signal "${sig.topic}": evidence start "${range.start}" is out of bounds`);
        continue;
      }
      if (e < 0) {
        errors.push(`signal "${sig.topic}": evidence end "${range.end}" is out of bounds`);
        continue;
      }
      if (s > e) {
        errors.push(`signal "${sig.topic}": inverted evidence range ${range.start}..${range.end}`);
      }
    }

    if (sig.type === "reference") {
      const found = sig.evidence.some((range) => {
        const s = indexOfMsgId(parsed, range.start);
        const e = indexOfMsgId(parsed, range.end);
        if (s < 0 || e < 0 || s > e) return false;
        const text = parsed
          .slice(s, e + 1)
          .map((m) => m.content)
          .join("\n");
        return text.includes(sig.url);
      });
      if (!found) {
        errors.push(
          `signal "${sig.topic}": reference.url "${sig.url}" not found in its evidence text (possible hallucination)`,
        );
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

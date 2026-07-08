/**
 * Long-session segmentation (spec §5.1).
 *
 * Splits a transcript into segments by a token budget on MESSAGE boundaries
 * (never by line count — a single JSONL line can be huge). A message that alone
 * exceeds the segment budget is sub-split by characters into `msg-N.k`
 * sub-segments, each carrying a continuation marker and its parent id so
 * reduce-time regrouping (map-reduce.ts) can stitch them back by parent.
 *
 * Token estimation is a coarse chars/4 heuristic — good enough for budgeting;
 * the real tokenizer is the model's own, and we only need to avoid overrunning.
 */

import type { MessageRole, ParsedMessage } from "./msg-id.js";

/** A message inside a segment; may be a sub-segment of an oversized message. */
export interface SegmentMessage {
  msgId: string;
  role: MessageRole;
  content: string;
  /** Present on sub-segments: the id of the message this was split from. */
  parentMsgId?: string;
  /** True on non-first sub-segments — signals continuation of a split message. */
  continued?: boolean;
}

export interface Segment {
  segNo: number;
  messages: SegmentMessage[];
}

export interface SegmentOpts {
  /** Max estimated tokens per segment. */
  maxSegmentTokens: number;
}

const CHARS_PER_TOKEN = 4;

/** Coarse token estimate (chars/4). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split an oversized message's content into chunks each under the char budget. */
function splitOversized(msg: ParsedMessage, maxSegmentTokens: number): SegmentMessage[] {
  const maxChars = Math.max(1, maxSegmentTokens * CHARS_PER_TOKEN);
  const out: SegmentMessage[] = [];
  let offset = 0;
  let sub = 1;
  while (offset < msg.content.length) {
    const slice = msg.content.slice(offset, offset + maxChars);
    out.push({
      msgId: `${msg.msgId}.${sub}`,
      role: msg.role,
      content: slice,
      parentMsgId: msg.msgId,
      continued: sub > 1,
    });
    offset += maxChars;
    sub += 1;
  }
  return out;
}

/**
 * Segment messages under a token budget. Oversized single messages are
 * sub-split; each sub-segment lands in its own segment (it already fills the
 * budget). Ordinary messages are packed greedily up to the budget.
 */
export function segmentMessages(parsed: ParsedMessage[], opts: SegmentOpts): Segment[] {
  const segments: Segment[] = [];
  let current: SegmentMessage[] = [];
  let currentTokens = 0;
  let segNo = 1;

  const flush = () => {
    if (current.length > 0) {
      segments.push({ segNo: segNo++, messages: current });
      current = [];
      currentTokens = 0;
    }
  };

  for (const msg of parsed) {
    const tokens = estimateTokens(msg.content);

    if (tokens > opts.maxSegmentTokens) {
      // Oversized: flush whatever is buffered, then emit each sub-segment as its
      // own segment.
      flush();
      for (const sub of splitOversized(msg, opts.maxSegmentTokens)) {
        segments.push({ segNo: segNo++, messages: [sub] });
      }
      continue;
    }

    if (currentTokens + tokens > opts.maxSegmentTokens && current.length > 0) {
      flush();
    }
    current.push({ msgId: msg.msgId, role: msg.role, content: msg.content });
    currentTokens += tokens;
  }
  flush();

  return segments;
}

/**
 * RawMessagePrivacyProcessor — pre-LLM redaction (spec §4.3, first pass).
 *
 * The legacy block pipeline sends raw messages to the LLM and only redacts the
 * structured ExtractionResult afterwards (privacy.ts / PrivacyProcessor) — so
 * the model sees un-redacted originals. For the distiller we fix that ordering:
 * this processor redacts raw message TEXT before it is ever handed to the LLM
 * (every map/reduce segment input goes through it first).
 *
 * It reuses the exact PrivacyConfig rules and patterns as PrivacyProcessor, but
 * operates on plain strings keyed by msg_id (not on ExtractionResult). In
 * reversible mode the restoration map is grouped by msg_id (spec §4.3) so an
 * authorized reader can recover the original text for a cited evidence range.
 */

import type { PrivacyConfig } from "../core/config.js";
import type { ParsedMessage } from "./msg-id.js";

/** A single reversible redaction: what was replaced, with what, and where. */
export interface RawRedactionEntry {
  original: string;
  replacement: string;
  /** Character offset in the redacted string (post-substitution). */
  position: number;
}

/** Restoration map: msg_id → the redactions applied to that message. */
export type RestorationMap = Record<string, RawRedactionEntry[]>;

export interface RedactMessagesResult {
  messages: ParsedMessage[];
  restorationMap: RestorationMap;
}

interface PatternSpec {
  regex: RegExp;
  replacement: string;
  enabled: boolean;
}

export class RawMessagePrivacyProcessor {
  constructor(private readonly config: PrivacyConfig) {}

  // Patterns mirror PrivacyProcessor (privacy.ts) — same PrivacyConfig rules.
  private patterns(): PatternSpec[] {
    return [
      { regex: /1[3-9]\d{9}/g, replacement: "[REDACTED_PHONE]", enabled: this.config.redact_phone },
      { regex: /\d{17}[\dXx]/g, replacement: "[REDACTED_ID]", enabled: this.config.redact_id_card },
      {
        regex: /\d{16,19}/g,
        replacement: "[REDACTED_CARD]",
        enabled: this.config.redact_bank_card,
      },
      // L2 IP address — always on in PrivacyProcessor.
      { regex: /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g, replacement: "[REDACTED_IP]", enabled: true },
    ];
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Redact one message's text. Returns the redacted string and (in reversible
   * mode) the ordered redaction entries.
   */
  private redactText(text: string): { text: string; entries: RawRedactionEntry[] } {
    const entries: RawRedactionEntry[] = [];
    let result = text;

    const applyPattern = (regex: RegExp, replacement: string) => {
      const matches: Array<{ original: string; position: number }> = [];
      const source = result;
      let m: RegExpExecArray | null;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex.exec loop
      while ((m = regex.exec(source)) !== null) {
        matches.push({ original: m[0], position: m.index });
      }
      regex.lastIndex = 0;
      // Apply in reverse to keep positions valid.
      for (let i = matches.length - 1; i >= 0; i--) {
        const mm = matches[i];
        result =
          result.slice(0, mm.position) +
          replacement +
          result.slice(mm.position + mm.original.length);
        if (this.config.mode === "reversible") {
          entries.push({ original: mm.original, replacement, position: mm.position });
        }
      }
    };

    for (const p of this.patterns()) {
      if (p.enabled) applyPattern(p.regex, p.replacement);
    }
    // L3 blocked words (case-insensitive).
    for (const word of this.config.blocked_words) {
      const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, "gi");
      applyPattern(regex, this.config.replacement);
    }

    return { text: result, entries };
  }

  /** Redact every message's text before it is sent to the LLM. */
  redactMessages(messages: ParsedMessage[]): RedactMessagesResult {
    if (!this.config.enabled) {
      return { messages, restorationMap: {} };
    }
    const restorationMap: RestorationMap = {};
    const redacted = messages.map((msg) => {
      const { text, entries } = this.redactText(msg.content);
      if (this.config.mode === "reversible" && entries.length > 0) {
        restorationMap[msg.msgId] = entries;
      }
      return { ...msg, content: text };
    });
    return { messages: redacted, restorationMap };
  }

  /**
   * Reverse redaction for a single message's (redacted) text using its
   * msg_id-keyed entries. Applies entries in forward order (they were recorded
   * against post-substitution offsets in reverse, so left-to-right restore is
   * position-stable because each restore preserves earlier offsets).
   */
  restore(msgId: string, redactedText: string, map: RestorationMap): string {
    const entries = map[msgId];
    if (!entries || entries.length === 0) return redactedText;
    // Restore from rightmost to leftmost so earlier offsets stay valid.
    const sorted = [...entries].sort((a, b) => b.position - a.position);
    let result = redactedText;
    for (const e of sorted) {
      const at = result.indexOf(e.replacement, e.position);
      const idx = at >= 0 ? at : result.indexOf(e.replacement);
      if (idx < 0) continue;
      result = result.slice(0, idx) + e.original + result.slice(idx + e.replacement.length);
    }
    return result;
  }
}

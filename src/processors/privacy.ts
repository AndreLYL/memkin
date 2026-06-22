/**
 * Privacy Processor for DigitalBrainExtractor
 * Redacts sensitive data in ExtractionResult with configurable L1/L2/L3 patterns
 */

import { appendFileSync } from "node:fs";
import type { PrivacyConfig } from "../core/config.js";
import { ensureStateDir, statePath } from "../core/state.js";
import type {
  Decision,
  Discovery,
  Entity,
  ExtractionResult,
  Knowledge,
  Link,
  Preference,
  Reference,
  SourceRef,
  TaskSignal,
} from "../core/types.js";

/**
 * Redaction entry for reversible mode
 */
interface RedactionEntry {
  field: string;
  original: string;
  replacement: string;
  position: number;
}

/**
 * Privacy Processor - redacts sensitive data in ExtractionResult
 *
 * Supports three levels of patterns:
 * - L1: Phone numbers, ID cards, bank cards (configurable)
 * - L2: IP addresses (always active)
 * - L3: Blocked words from config
 *
 * Modes:
 * - reversible: generates .memoark/redaction_map.jsonl for recovery
 * - irreversible: redacts without keeping recovery map
 *
 * Protected fields (never redacted):
 * - Entity.name
 * - SourceRef.raw_hash
 */
export class PrivacyProcessor {
  private config: PrivacyConfig;
  private redactionMap: RedactionEntry[] = [];
  private stateBase?: string;

  // L1 Patterns
  private phoneRegex = /1[3-9]\d{9}/g;
  private idCardRegex = /\d{17}[\dXx]/g;
  private bankCardRegex = /\d{16,19}/g;

  // L2 Patterns
  private ipRegex = /\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/g;

  constructor(config: PrivacyConfig, options: { stateBase?: string } = {}) {
    this.config = config;
    this.stateBase = options.stateBase;
  }

  /**
   * Main entry point - process ExtractionResult and apply redactions
   */
  process(result: ExtractionResult): ExtractionResult {
    if (!this.config.enabled) {
      return result;
    }

    // Reset redaction map for this processing
    this.redactionMap = [];

    // Process each field group
    const processed: ExtractionResult = {
      source: this.processSourceRef(result.source),
      entities: result.entities.map((e) => this.processEntity(e)),
      timeline: result.timeline.map((t) => ({
        ...t,
        summary: this.redactText(t.summary, "timeline.summary"),
        source: this.processSourceRef(t.source),
      })),
      links: result.links.map((l) => this.processLink(l)),
      decisions: result.decisions.map((d) => this.processDecision(d)),
      tasks: result.tasks.map((t) => this.processTask(t)),
      discoveries: result.discoveries.map((d) => this.processDiscovery(d)),
      knowledge: result.knowledge.map((k) => this.processKnowledge(k)),
      preferences: result.preferences.map((p) => this.processPreference(p)),
      references: result.references.map((r) => this.processReference(r)),
    };

    // Write redaction map if in reversible mode
    if (this.config.mode === "reversible" && this.redactionMap.length > 0) {
      this.writeRedactionMap();
    }

    return processed;
  }

  /**
   * Process SourceRef - redacts quote and url, but NOT raw_hash
   */
  private processSourceRef(source: SourceRef): SourceRef {
    return {
      ...source,
      quote: this.redactText(source.quote, "sourceRef.quote"),
      url: source.url ? this.redactText(source.url, "sourceRef.url") : source.url,
      // raw_hash is NEVER redacted
    };
  }

  /**
   * Process Entity - redacts context, but NOT name or slug
   */
  private processEntity(entity: Entity): Entity {
    return {
      ...entity,
      context: this.redactText(entity.context, "entity.context"),
      // name and slug are NEVER redacted
    };
  }

  /**
   * Process Decision - redacts summary and reasoning
   */
  private processDecision(decision: Decision): Decision {
    return {
      ...decision,
      summary: this.redactText(decision.summary, "decision.summary"),
      reasoning: decision.reasoning
        ? this.redactText(decision.reasoning, "decision.reasoning")
        : decision.reasoning,
      source: this.processSourceRef(decision.source),
    };
  }

  /**
   * Process TaskSignal - redacts title
   */
  private processTask(task: TaskSignal): TaskSignal {
    return {
      ...task,
      title: this.redactText(task.title, "task.title"),
      source: this.processSourceRef(task.source),
    };
  }

  /**
   * Process Link - redacts context
   */
  private processLink(link: Link): Link {
    return {
      ...link,
      context: this.redactText(link.context, "link.context"),
      source: this.processSourceRef(link.source),
    };
  }

  /**
   * Process Discovery - redacts summary and detail
   */
  private processDiscovery(discovery: Discovery): Discovery {
    return {
      ...discovery,
      summary: this.redactText(discovery.summary, "discovery.summary"),
      detail: discovery.detail
        ? this.redactText(discovery.detail, "discovery.detail")
        : discovery.detail,
      source: this.processSourceRef(discovery.source),
    };
  }

  /**
   * Process Knowledge - redacts content and applies blocked words to topic
   * Topic only gets L3 (blocked words) redaction, NOT L1/L2
   * related_entities are NEVER redacted
   */
  private processKnowledge(knowledge: Knowledge): Knowledge {
    return {
      ...knowledge,
      content: this.redactText(knowledge.content, "knowledge.content"),
      topic: this.redactBlockedWordsOnly(knowledge.topic, "knowledge.topic"),
      source: this.processSourceRef(knowledge.source),
    };
  }

  /**
   * Process Preference - redacts summary and detail
   */
  private processPreference(preference: Preference): Preference {
    return {
      ...preference,
      summary: this.redactText(preference.summary, "preference.summary"),
      detail: preference.detail
        ? this.redactText(preference.detail, "preference.detail")
        : preference.detail,
      source: this.processSourceRef(preference.source),
    };
  }

  /**
   * Process Reference - redacts summary and trigger
   * title and url are NOT redacted (url is the core field; title is a document name)
   */
  private processReference(reference: Reference): Reference {
    return {
      ...reference,
      summary: this.redactText(reference.summary, "reference.summary"),
      trigger: reference.trigger
        ? this.redactText(reference.trigger, "reference.trigger")
        : reference.trigger,
      source: this.processSourceRef(reference.source),
    };
  }

  /**
   * Redact blocked words only (L3 only, no L1/L2 regex)
   * Used for topic field which should not match phone/ID/IP patterns
   */
  private redactBlockedWordsOnly(text: string, fieldName: string): string {
    let result = text;
    for (const word of this.config.blocked_words) {
      const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, "gi");
      result = this.applyRedaction(result, regex, this.config.replacement, fieldName);
    }
    return result;
  }

  /**
   * Redact text by applying all enabled patterns
   * Tracks replacements for reversible mode
   */
  private redactText(text: string, fieldName: string): string {
    let result = text;

    // L1 Patterns - Phone
    if (this.config.redact_phone) {
      result = this.applyRedaction(result, this.phoneRegex, "[REDACTED_PHONE]", fieldName);
    }

    // L1 Patterns - ID Card
    if (this.config.redact_id_card) {
      result = this.applyRedaction(result, this.idCardRegex, "[REDACTED_ID]", fieldName);
    }

    // L1 Patterns - Bank Card
    if (this.config.redact_bank_card) {
      result = this.applyRedaction(result, this.bankCardRegex, "[REDACTED_CARD]", fieldName);
    }

    // L2 Patterns - IP Address (always applied)
    result = this.applyRedaction(result, this.ipRegex, "[REDACTED_IP]", fieldName);

    // L3 Patterns - Blocked Words (case-insensitive)
    for (const word of this.config.blocked_words) {
      const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, "gi");
      result = this.applyRedaction(result, regex, this.config.replacement, fieldName);
    }

    return result;
  }

  /**
   * Apply redaction with pattern and track in map if reversible mode
   * Important: pattern matching happens on the original text before any replacements
   */
  private applyRedaction(
    text: string,
    regex: RegExp,
    replacement: string,
    fieldName: string,
  ): string {
    let match: RegExpExecArray | null;
    const matches: Array<{ original: string; position: number }> = [];

    // Find all matches first on the original text
    const originalText = text;
    // biome-ignore lint/suspicious/noAssignInExpressions: Standard pattern for regex.exec() iteration
    while ((match = regex.exec(originalText)) !== null) {
      matches.push({
        original: match[0],
        position: match.index,
      });
    }

    // Reset regex for next use
    regex.lastIndex = 0;

    // Apply replacements in reverse order to maintain positions
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const before = text.substring(0, m.position);
      const after = text.substring(m.position + m.original.length);
      text = before + replacement + after;

      // Track for reversible mode
      if (this.config.mode === "reversible") {
        this.redactionMap.push({
          field: fieldName,
          original: m.original,
          replacement: replacement,
          position: m.position,
        });
      }
    }

    return text;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /**
   * Write redaction map to .memoark/redaction_map.jsonl
   */
  private writeRedactionMap(): void {
    try {
      ensureStateDir(this.stateBase);
      const mapPath = statePath("redaction_map.jsonl", this.stateBase);

      for (const entry of this.redactionMap) {
        appendFileSync(mapPath, `${JSON.stringify(entry)}\n`);
      }
    } catch (error) {
      throw new Error(`Failed to write redaction map: ${error}`);
    }
  }
}

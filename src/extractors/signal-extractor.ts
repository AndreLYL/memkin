/**
 * Signal Extractor - Core LLM-based signal extraction
 *
 * Orchestrates the extraction of structured signals from conversation blocks:
 * 1. Formats conversation into readable text
 * 2. Calls LLM with structured JSON schema
 * 3. Validates output with Zod
 * 4. Retries once on validation failure with error feedback
 * 5. Returns BlockResult (ok/failed) - never returns empty on failure
 */

import { createHash } from "node:crypto";
import { extractQuickEntities } from "../core/entity-extract.js";
import { PROMPTS } from "../embedded-assets.generated.js";
import { parseExtractionResult } from "../core/schemas.js";
import type {
  BlockResult,
  CanonicalisedBlock,
  ConversationBlock,
  ExtractionResult,
  RawMessage,
  SourceRef,
} from "../core/types.js";
import type { ChatMessage, LLMProvider } from "./providers/types.js";

function extractJson(raw: string): string | null {
  // Strip leading/trailing whitespace and code fences
  let s = raw.trim();
  // Remove leading ```json or ``` (any number of backticks)
  s = s.replace(/^`{3,}(?:json|JSON)?\s*\n?/, "");
  // Remove trailing ```
  s = s.replace(/\n?\s*`{3,}\s*$/, "");
  s = s.trim();

  // Try direct parse first
  try {
    JSON.parse(s);
    return s;
  } catch {}

  // Find the outermost { ... } or [ ... ] via bracket matching
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  const start =
    firstBrace >= 0 && (firstBracket < 0 || firstBrace < firstBracket) ? firstBrace : firstBracket;
  if (start < 0) return null;

  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (isEscaped) {
      isEscaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      isEscaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Signal Extractor interface
 */
export interface SignalExtractor {
  extract(input: CanonicalisedBlock | ConversationBlock): Promise<BlockResult>;
}

/**
 * Load prompt template from file
 */
function loadPrompt(filename: string): string {
  const prompt = PROMPTS[filename];
  if (prompt === undefined) throw new Error(`Embedded prompt not found: ${filename}`);
  return prompt;
}

/**
 * Build a "Detected Structural Signals" hint section from quick-entity extraction.
 * Returns empty string when no entities are found (no section injected).
 * Exported for unit testing.
 */
export function buildEntityHintsSection(text: string): string {
  const entities = extractQuickEntities(text);
  if (entities.length === 0) return "";

  const byType = new Map<string, string[]>();
  for (const e of entities) {
    const list = byType.get(e.type) ?? [];
    list.push(e.value);
    byType.set(e.type, list);
  }

  const lines: string[] = ["## Detected Structural Signals", ""];
  for (const [type, values] of byType) {
    const preview = values.slice(0, 5).join(", ");
    const overflow = values.length > 5 ? ` (+${values.length - 5} more)` : "";
    lines.push(`- ${type}s: ${preview}${overflow}`);
  }
  return `\n\n${lines.join("\n")}`;
}

/**
 * Format conversation messages into readable text
 */
function formatConversation(messages: RawMessage[]): string {
  return messages
    .map((msg) => {
      const timestamp = new Date(msg.timestamp).toISOString();
      const direction = msg.direction === "sent" ? "→" : "←";
      return `[${timestamp}] ${direction} ${msg.contact}: ${msg.content}`;
    })
    .join("\n");
}

/**
 * Hash function for generating raw_hash from conversation block
 */
function hashBlock(block: ConversationBlock): string {
  const messageIds = block.messages
    .map((m) => {
      const mid = m.metadata?.message_id as string | undefined;
      if (mid) return mid;
      const contentHash = createHash("sha256").update(m.content).digest("hex").slice(0, 8);
      return `${m.timestamp}:${m.contact}:${contentHash}`;
    })
    .sort()
    .join(",");
  const data = [
    block.platform,
    block.channel,
    block.thread_id ?? "",
    messageIds,
    block.start_time,
    block.end_time,
  ].join("|");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function buildSourceRef(block: ConversationBlock): SourceRef {
  return {
    platform: block.platform,
    channel: block.channel,
    timestamp: block.start_time,
    start_time: block.start_time,
    end_time: block.end_time,
    thread_id: block.thread_id,
    message_ids: block.messages.map((m) => m.metadata?.message_id as string).filter(Boolean),
    raw_hash: hashBlock(block),
    quote: "",
  };
}

function stampSourceRefs(result: ExtractionResult, canonical: SourceRef): void {
  result.source = { ...canonical, quote: result.source.quote || canonical.quote };
  const stamp = (s: SourceRef) => ({ ...canonical, quote: s.quote || canonical.quote });
  for (const d of result.decisions) d.source = stamp(d.source);
  for (const t of result.tasks) t.source = stamp(t.source);
  for (const disc of result.discoveries) disc.source = stamp(disc.source);
  for (const k of result.knowledge) k.source = stamp(k.source);
  for (const tl of result.timeline) tl.source = stamp(tl.source);
  for (const link of result.links) link.source = stamp(link.source);
}

/**
 * Create a signal extractor with the given LLM provider
 */
export function createSignalExtractor(provider: LLMProvider): SignalExtractor {
  const systemPrompt = loadPrompt("system.md");
  const signalExtractPrompt = loadPrompt("signal-extract.md");

  return {
    async extract(input: CanonicalisedBlock | ConversationBlock): Promise<BlockResult> {
      // Determine input type and extract the underlying block and conversation text
      const isCanonicalized = "canonical_markdown" in input;
      const block = isCanonicalized
        ? (input as CanonicalisedBlock).block
        : (input as ConversationBlock);
      const cb = isCanonicalized ? (input as CanonicalisedBlock) : null;

      // Get conversation text: use canonical_markdown for email/document/structured sources
      let conversationText: string;
      if (
        cb &&
        (cb.source_type === "email" ||
          cb.source_type === "document" ||
          cb.source_type === "structured")
      ) {
        conversationText = cb.canonical_markdown;
      } else {
        conversationText = formatConversation(block.messages);
      }

      // Build prompt with context
      const entityHints = buildEntityHintsSection(conversationText);
      const userPrompt = `${signalExtractPrompt}

## Conversation Block

**Platform:** ${block.platform}
**Channel:** ${block.channel}
**Thread ID:** ${block.thread_id || "N/A"}
**Time Range:** ${block.start_time} to ${block.end_time}
**Participants:** ${block.participants.join(", ")}

## Messages

${conversationText}${entityHints}

## Instructions

Extract all signals from the above conversation following the schema and examples.
Output ONLY valid JSON matching ExtractionResultSchema.`;

      // First attempt
      let lastError: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const messages: ChatMessage[] = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ];

          // If this is a retry, include error feedback
          if (attempt > 0 && lastError) {
            messages.push({
              role: "user",
              content: `The previous response had validation errors:\n${lastError}\n\nPlease fix the issues and provide valid JSON matching the schema.`,
            });
          }

          // Call LLM
          const response = await provider.chat(messages, {
            responseFormat: "json",
            temperature: 0.2,
            maxTokens: 32000,
          });

          // Parse and validate JSON
          let jsonData: unknown;
          try {
            jsonData = JSON.parse(response);
          } catch {
            // Try harder: extract JSON from markdown/text wrapping
            const cleaned = extractJson(response);
            if (cleaned) {
              try {
                jsonData = JSON.parse(cleaned);
              } catch (err2) {
                lastError = `JSON parse error after cleanup: ${err2 instanceof Error ? err2.message : String(err2)}. Cleaned content starts: ${cleaned.substring(0, 100)}`;
                continue;
              }
            } else {
              lastError = `No valid JSON found in response (len=${response.length}, starts: ${response.substring(0, 80)}...)`;
              continue;
            }
          }

          // Validate with Zod
          const result = parseExtractionResult(jsonData);

          // System stamp: overwrite LLM-generated source fields with canonical provenance
          const canonical = buildSourceRef(block);
          stampSourceRefs(result, canonical);

          return { status: "ok", data: result };
        } catch (err) {
          // Capture validation error for retry
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt === 1) {
            // Second attempt failed - give up
            return {
              status: "failed",
              error: `Signal extraction validation failed after retry: ${lastError}`,
            };
          }
          // Continue to retry
        }
      }

      // Should not reach here, but handle it
      return {
        status: "failed",
        error: `Signal extraction failed: ${lastError || "unknown error"}`,
      };
    },
  };
}

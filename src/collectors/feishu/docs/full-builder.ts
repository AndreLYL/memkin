import type { LLMProvider } from "../../../extractors/providers/types.js";
import type { IFeishuHttpClient } from "../http-client.js";
import { type FeishuBlock, feishuBlocksToDocBlocks, feishuBlocksToRawText } from "./blocks.js";
import { computeSourceBodyHash } from "./hash.js";
import { LlmJsonParseError, parseLlmJson } from "./llm-json.js";
import { buildPointerCard } from "./pointer-builder.js";
import { extractTocFromBlocks } from "./toc.js";
import type { DocCandidate, DocCard, EntityMention, FullCard } from "./types.js";

const MIN_CONTENT_CHARS = 200;

function buildPrompt(rawText: string, userNote?: string): string {
  const noteLine = userNote ? `\nThe user says this document's purpose is: "${userNote}". Use it.` : "";
  return [
    "Summarize the following document into JSON with keys:",
    '{ "purpose": string (<=50 chars), "topics": string[] (3-7), "entities": {name, type_guess}[], "overview": string (200-400 chars) }.',
    'type_guess ∈ person|project|tool|concept|organization. Reply with JSON only, no markdown.',
    noteLine,
    "\n---\n",
    rawText.slice(0, 12000),
  ].join("\n");
}

export class FullCardBuilder {
  constructor(
    private readonly client: IFeishuHttpClient,
    private readonly provider: LLMProvider,
    private readonly model: string,
    private readonly nowIso: () => string,
  ) {}

  private async fetchBlocks(docToken: string): Promise<FeishuBlock[]> {
    const blocks: FeishuBlock[] = [];
    // ⚠️ CALIBRATE: path + ndjson row shape against Task 1.
    for await (const page of this.client.paginate<FeishuBlock>(
      `/open-apis/docx/v1/documents/${docToken}/blocks`,
    )) {
      blocks.push(...page.items);
    }
    return blocks;
  }

  async build(candidate: DocCandidate, opts?: { userNote?: string; tags?: string[] }): Promise<DocCard> {
    const now = this.nowIso();
    let blocks: FeishuBlock[];
    try {
      blocks = await this.fetchBlocks(candidate.doc_token);
    } catch {
      return buildPointerCard(candidate, now, { extract_error: "blocks_fetch_failed", user_note: opts?.userNote });
    }

    if (blocks.length === 0) {
      return buildPointerCard(candidate, now, { extract_skipped: "empty_blocks", user_note: opts?.userNote });
    }

    const rawText = feishuBlocksToRawText(blocks);
    if (rawText.length < MIN_CONTENT_CHARS) {
      return buildPointerCard(candidate, now, { extract_skipped: "below_min_chars", user_note: opts?.userNote });
    }

    let parsed: Record<string, unknown>;
    try {
      const out = await this.provider.chat(
        [{ role: "user", content: buildPrompt(rawText, opts?.userNote) }],
        { responseFormat: "json" },
      );
      parsed = parseLlmJson(out);
    } catch (err) {
      const code = err instanceof LlmJsonParseError ? "llm_invalid_json" : "llm_failed";
      return buildPointerCard(candidate, now, { extract_error: code, user_note: opts?.userNote });
    }

    const entities = Array.isArray(parsed.entities) ? (parsed.entities as EntityMention[]) : [];
    const card: FullCard = {
      ...candidate,
      extract_level: "full",
      purpose: String(parsed.purpose ?? "").slice(0, 50),
      topics: Array.isArray(parsed.topics) ? (parsed.topics as string[]) : [],
      entities,
      toc: extractTocFromBlocks(feishuBlocksToDocBlocks(blocks)),
      overview: String(parsed.overview ?? ""),
      source_body_hash: computeSourceBodyHash(rawText),
      summary_generated_at: now,
      summary_model: this.model,
      extracted_at: now,
      ...(opts?.userNote ? { user_note: opts.userNote } : {}),
      ...(opts?.tags ? { tags: opts.tags } : {}),
    };
    return card;
  }
}

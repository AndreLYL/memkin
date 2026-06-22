import type { LLMProvider } from "../../../extractors/providers/types.js";
import type { IFeishuHttpClient } from "../http-client.js";
import { type FeishuBlock, feishuBlocksToDocBlocks, feishuBlocksToRawText } from "./blocks.js";
import { computeSourceBodyHash } from "./hash.js";
import { LlmJsonParseError, parseLlmJson } from "./llm-json.js";
import { buildPointerCard } from "./pointer-builder.js";
import { extractTocFromBlocks } from "./toc.js";
import type {
  ActionItem,
  DocCandidate,
  DocCard,
  DocDecision,
  EntityMention,
  FullCard,
} from "./types.js";

const MIN_CONTENT_CHARS = 200;

function buildPrompt(rawText: string, userNote?: string): string {
  const noteLine = userNote
    ? `\nThe user says this document's purpose is: "${userNote}". Use it.`
    : "";
  return [
    "Summarize the following document into JSON with keys:",
    '{ "purpose": string (<=50 chars), "topics": string[] (3-7), "entities": {name, type_guess}[], "overview": string (200-400 chars), "decisions": {text, made_by}[], "action_items": {text, owner, due}[] }.',
    "type_guess ∈ person|project|tool|concept|organization.",
    "decisions: concrete choices the document records (each with who made it, or null).",
    'action_items: concrete to-dos, each with its owner (name/@mention, or null) and due date (ISO8601 "YYYY-MM-DD", or null). For meeting-minutes docs, extract every action item and its owner.',
    "Reply with JSON only, no markdown.",
    noteLine,
    "\n---\n",
    rawText.slice(0, 12000),
  ].join("\n");
}

interface RawDecision {
  text?: unknown;
  made_by?: unknown;
}

interface RawActionItem {
  text?: unknown;
  owner?: unknown;
  due?: unknown;
  status?: unknown;
}

function parseDecisions(value: unknown): DocDecision[] {
  if (!Array.isArray(value)) return [];
  const out: DocDecision[] = [];
  for (const raw of value as RawDecision[]) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    const decision: DocDecision = { text };
    if (typeof raw.made_by === "string" && raw.made_by.trim()) {
      decision.made_by_raw = raw.made_by.trim();
    }
    out.push(decision);
  }
  return out;
}

function parseActionItems(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return [];
  const out: ActionItem[] = [];
  for (const raw of value as RawActionItem[]) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (!text) continue;
    const item: ActionItem = {
      text,
      status: raw.status === "done" ? "done" : "open",
    };
    if (typeof raw.owner === "string" && raw.owner.trim()) item.owner_raw = raw.owner.trim();
    if (typeof raw.due === "string" && raw.due.trim()) item.due = raw.due.trim();
    out.push(item);
  }
  return out;
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
    // CALIBRATED 2026-06-14: the GET /open-apis/docx/v1/documents/<id>/blocks
    // endpoint and ndjson row shape are confirmed live — each row carries an
    // integer `block_type` plus a per-type holder with elements[].text_run.content
    // (see blocks.ts#BLOCK_MAP and probe-fixtures.md docx_block fixture).
    for await (const page of this.client.paginate<FeishuBlock>(
      `/open-apis/docx/v1/documents/${docToken}/blocks`,
    )) {
      blocks.push(...page.items);
    }
    return blocks;
  }

  async build(
    candidate: DocCandidate,
    opts?: { userNote?: string; tags?: string[]; force?: boolean },
  ): Promise<DocCard> {
    const now = this.nowIso();
    let blocks: FeishuBlock[];
    try {
      blocks = await this.fetchBlocks(candidate.doc_token);
    } catch {
      return buildPointerCard(candidate, now, {
        extract_error: "blocks_fetch_failed",
        user_note: opts?.userNote,
      });
    }

    if (blocks.length === 0) {
      return buildPointerCard(candidate, now, {
        extract_skipped: "empty_blocks",
        user_note: opts?.userNote,
      });
    }

    const rawText = feishuBlocksToRawText(blocks);
    if (!opts?.force && rawText.length < MIN_CONTENT_CHARS) {
      return buildPointerCard(candidate, now, {
        extract_skipped: "below_min_chars",
        user_note: opts?.userNote,
      });
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
      decisions: parseDecisions(parsed.decisions),
      action_items: parseActionItems(parsed.action_items),
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

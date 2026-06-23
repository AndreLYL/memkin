/**
 * Playbook-aware extractor (Spec 11 §五).
 *
 * Two-part flow attached to the SignalExtractor stage of the pipeline:
 *
 *   1. pre-classify (`classifyPlaybook`): a lightweight rule-based check — does this
 *      block describe a troubleshooting *procedure*? Cheap keyword heuristics; an
 *      optional LLM second-check refines borderline cases.
 *   2. playbook extraction (`extractPlaybookDraft`): on a hit, ask the LLM to emit the
 *      §四 markdown structure (适用场景 / 步骤 / 命中→含义分支 / 关联 `[[rel:slug]]`) and
 *      write a `type=playbook` *draft* page (`frontmatter.confidence = "inferred"`,
 *      tag `draft`). The page body IS the compiled_truth (text/markdown, not JSON).
 *
 * Draft pages await human confirmation (→ `confidence: confirmed`). Wikilinks in the
 * body auto-wire hierarchy/order edges via Spec 10 on putPage.
 */

import { createHash } from "node:crypto";
import type { ConversationBlock, RawMessage } from "../core/types.js";
import type { LLMProvider } from "./providers/types.js";

// Rule keywords that signal a troubleshooting / runbook flow (Spec 11 §五 A).
const PLAYBOOK_KEYWORDS = ["排查", "步骤", "grep", "日志", "runbook", "playbook"];
// "如果……则" conditional-branch pattern.
const CONDITIONAL_RE = /如果[\s\S]{0,40}?则/;

/**
 * Rule-based pre-classify: is `text` a troubleshooting procedure? Zero-LLM, cheap.
 * Requires at least two distinct signals (keyword hits and/or a conditional branch)
 * so ordinary chatter that merely mentions one keyword is not misclassified.
 */
export function classifyPlaybook(text: string): boolean {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of PLAYBOOK_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) hits++;
  }
  if (CONDITIONAL_RE.test(text)) hits++;
  return hits >= 2;
}

const PLAYBOOK_EXTRACT_PROMPT = [
  "你是排查手册（playbook）抽取器。下面是一段排查类对话/文档。",
  "请把它整理为 markdown 排查手册，严格使用以下结构：",
  "## 适用场景\n（一句话描述何时用）",
  "## 步骤\n（有序步骤；命中某结果时用 `- 命中 X → 含义/下一步` 表达分支）",
  "## 关联\n（用 [[part_of:problem-class/...]] / [[precedes:playbook/...]] 标注层级与顺序，可省略）",
  "只输出 markdown 正文，不要额外解释，不要代码围栏，不要 frontmatter。",
].join("\n\n");

function formatConversation(messages: RawMessage[]): string {
  return messages
    .map((m) => `[${new Date(m.timestamp).toISOString()}] ${m.contact}: ${m.content}`)
    .join("\n");
}

function kebabCase(str: string): string {
  const ascii = str
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length >= 3) return ascii;
  const hash = createHash("sha256").update(str).digest("hex").slice(0, 12);
  return ascii ? `${ascii}-${hash}` : hash;
}

/** Derive a playbook title from the first non-empty line / first messages of the block. */
function deriveTitle(block: ConversationBlock): string {
  const firstContent = block.messages[0]?.content ?? "";
  const firstLine = firstContent.split("\n").find((l) => l.trim().length > 0) ?? "playbook";
  // Trim to a reasonable title length; strip trailing punctuation.
  return (
    firstLine
      .trim()
      .replace(/[：:。.\s]+$/, "")
      .slice(0, 40) || "playbook"
  );
}

/** Minimal store surface the playbook extractor needs (a PageStore-compatible `putPage`). */
export interface PlaybookPageWriter {
  putPage(slug: string, content: string): Promise<unknown>;
}

/**
 * Run the playbook extraction branch: LLM produces §四 markdown, write a draft
 * `type=playbook` page. Returns the written slug, or null when the LLM produced no
 * usable body. Never throws on empty output.
 */
export async function extractPlaybookDraft(
  block: ConversationBlock,
  provider: LLMProvider,
  pages: PlaybookPageWriter,
): Promise<string | null> {
  const conversation = formatConversation(block.messages);
  const body = (
    await provider.chat(
      [
        { role: "system", content: PLAYBOOK_EXTRACT_PROMPT },
        { role: "user", content: conversation },
      ],
      { responseFormat: "text", temperature: 0.2 },
    )
  ).trim();

  if (!body) return null;

  const title = deriveTitle(block);
  const slug = `playbook/${kebabCase(title)}`;
  const frontmatter = [
    "---",
    `title: ${title}`,
    "type: playbook",
    "confidence: inferred",
    "tags:",
    "  - draft",
    "---",
  ].join("\n");

  await pages.putPage(slug, `${frontmatter}\n${body}`);
  return slug;
}

import { stringify as stringifyYaml } from "yaml";
import type { DocCard, FullCard } from "./types.js";

const PAGE_TYPE = "feishu_doc_card";

/**
 * Build the frontmatter object. `title` and `type` are top-level so
 * PageStore.parseMarkdownWithFrontmatter lifts them; everything else is
 * preserved as nested frontmatter for programmatic query.
 */
function frontmatter(card: DocCard): Record<string, unknown> {
  const fm: Record<string, unknown> = {
    title: card.title,
    type: PAGE_TYPE,
    extract_level: card.extract_level,
    doc_token: card.doc_token,
    doc_type: card.doc_type,
    url: card.url,
    owner_id: card.owner_id,
    last_editor_id: card.last_editor_id,
    created_at: card.created_at,
    modified_at: card.modified_at,
    extracted_at: card.extracted_at,
    parent_path: card.parent_path,
    source: card.source,
  };

  if (card.extract_level === "full") {
    fm.purpose = card.purpose;
    fm.topics = card.topics;
    fm.entities = card.entities;
    fm.toc = card.toc;
    fm.overview = card.overview;
    fm.decisions = card.decisions;
    fm.action_items = card.action_items;
    fm.source_body_hash = card.source_body_hash;
    fm.summary_generated_at = card.summary_generated_at;
    fm.summary_model = card.summary_model;
    if (card.user_note !== undefined) fm.user_note = card.user_note;
    if (card.tags !== undefined) fm.tags = card.tags;
  } else {
    if (card.extract_error !== undefined) fm.extract_error = card.extract_error;
    if (card.extract_skipped !== undefined) fm.extract_skipped = card.extract_skipped;
    if (card.user_note !== undefined) fm.user_note = card.user_note;
  }

  return fm;
}

function fullBody(card: FullCard): string {
  const topics = card.topics.map((t) => `- ${t}`).join("\n");
  const entities = card.entities.map((e) => `- ${e.name} (${e.type_guess})`).join("\n");
  const toc = card.toc.map((i) => `- ${i.title}`).join("\n");
  return [
    `# ${card.title}`,
    "",
    `**Purpose**: ${card.purpose}`,
    `**URL**: ${card.url}`,
    `**Last modified**: ${card.modified_at} by ${card.last_editor_id}`,
    "",
    "## Overview",
    card.overview,
    "",
    "## Topics",
    topics,
    "",
    "## Mentioned entities",
    entities,
    "",
    "## Table of contents",
    toc,
    "",
    "---",
    `*Source: Feishu ${card.source.kind} / ${card.parent_path}*`,
    "",
  ].join("\n");
}

function pointerBody(card: DocCard): string {
  const errorSuffix =
    card.extract_level === "pointer" && card.extract_error
      ? ` Last error: ${card.extract_error}`
      : "";
  return [
    `# ${card.title}`,
    "",
    `**URL**: ${card.url}`,
    `**Last modified**: ${card.modified_at}`,
    `**Source**: Feishu ${card.source.kind} / ${card.parent_path}`,
    "",
    `*(Pointer card — full summary not yet generated.${errorSuffix})*`,
    "",
  ].join("\n");
}

export function renderDocCardMarkdown(card: DocCard): string {
  const yaml = stringifyYaml(frontmatter(card)).trimEnd();
  const body = card.extract_level === "full" ? fullBody(card) : pointerBody(card);
  return `---\n${yaml}\n---\n\n${body}`;
}

/**
 * MCP ingest: the user note is the authoritative purpose. Forced post-LLM
 * because the model cannot be trusted to obey the instruction reliably.
 */
export function mergeUserNoteIntoCard(card: FullCard, userNote: string): FullCard {
  return { ...card, purpose: userNote, user_note: userNote };
}

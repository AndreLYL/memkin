// ── Source origin ────────────────────────────────────────────────
export type DocSourceOrigin =
  | { kind: "my_space"; folder_token: string }
  | { kind: "wiki"; space_id: string; space_name: string; node_token: string }
  | { kind: "folder"; folder_token: string; folder_name: string }
  | { kind: "mcp_ingest" };

// ── Intermediate candidate (emitted by walkers in Plan 2) ────────
export interface DocCandidate {
  doc_token: string;
  doc_type: "docx"; // v1 only
  title: string;
  url: string;
  owner_id: string; // open_id
  last_editor_id: string; // open_id
  created_at: string; // ISO8601
  modified_at: string; // ISO8601
  source: DocSourceOrigin;
  parent_path: string; // "Wiki/Research/Memkin/"
}

// ── Cards ────────────────────────────────────────────────────────
export interface EntityMention {
  name: string;
  type_guess: "person" | "project" | "tool" | "concept" | "organization";
}

export interface TocItem {
  level: 1 | 2 | 3;
  title: string;
}

// ── Decisions + action items extracted from a doc (Spec 9 §3.1) ───
export interface DocDecision {
  text: string;
  made_by_raw?: string; // who made the decision, as written in the doc
}

export interface ActionItem {
  text: string;
  owner_raw?: string; // owner as written in the doc (name / @mention)
  owner_slug?: string; // identity-layer-resolved person slug (§4)
  due?: string; // ISO8601, optional
  status: "open" | "done";
}

export interface PointerCard extends DocCandidate {
  extract_level: "pointer";
  extracted_at: string;
  extract_error?: string;
  extract_skipped?: string;
  user_note?: string;
}

export interface FullCard extends DocCandidate {
  extract_level: "full";
  // LLM-generated
  purpose: string;
  topics: string[];
  entities: EntityMention[];
  toc: TocItem[];
  overview: string;
  decisions: DocDecision[];
  action_items: ActionItem[];
  // metadata
  source_body_hash: string; // sha256(Feishu raw_content) — NOT pages.content_hash
  summary_generated_at: string;
  summary_model: string;
  extracted_at: string;
  user_note?: string;
  tags?: string[];
}

export type DocCard = PointerCard | FullCard;

// ── Normalized block input for the TOC extractor ─────────────────
// Plan 2's FullCardBuilder maps Feishu docx blocks → DocBlock[] before
// calling extractTocFromBlocks. Keeping this normalized contract here
// lets the TOC extractor stay pure and Feishu-API-agnostic.
export interface DocBlock {
  type: "heading1" | "heading2" | "heading3" | "text" | "other";
  text: string;
}

// ── Decision engine config (subset of memkin.yaml docs config) ──
export interface DocDecisionConfig {
  self_edit: boolean; // T1
  recent_window_days: number | null; // T2: null = off
  important_folders: string[]; // T4 folder_tokens
  important_wiki_spaces: string[]; // T4 wiki space_ids
}

// ── Decision engine outputs ──────────────────────────────────────
export type Decision =
  | { action: "skip_save" }
  | { action: "save_pointer"; reason: string }
  | { action: "queue_for_upgrade"; trigger: string }
  | { action: "needs_body_check" }; // existing FullCard + modified_at changed

export type BodyCheckDecision =
  | { action: "metadata_refresh" }
  | { action: "queue_for_upgrade"; trigger: "T5" };

// ── URL parser output ────────────────────────────────────────────
export type ParsedFeishuUrl =
  | { kind: "docx"; token: string }
  | { kind: "wiki_node"; node_token: string }
  | { kind: "reject"; code: "INVALID_URL" | "UNSUPPORTED_DOC_TYPE"; message: string };

/**
 * Core type definitions for DigitalBrainExtractor (DBE)
 * Pure TypeScript interfaces with no runtime validation
 */

export interface Attachment {
  id: string;
  type: string;
  url?: string;
  name?: string;
}

export interface RawMessage {
  platform: string;
  channel: string;
  contact: string;
  timestamp: string; // ISO 8601
  content: string;
  direction: "sent" | "received";
  metadata?: Record<string, unknown>;
  attachments?: Attachment[];
}

export interface FetchOpts {
  cursor?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface ConversationBlock {
  block_id: string;
  platform: string;
  channel: string;
  thread_id?: string;
  messages: RawMessage[];
  start_time: string; // ISO 8601
  end_time: string; // ISO 8601
  participants: string[];
  token_count: number;
}

export interface SourceRef {
  platform: string;
  channel: string;
  channel_name?: string;
  timestamp: string; // ISO 8601
  start_time?: string;
  end_time?: string;
  message_id?: string;
  message_ids?: string[];
  thread_id?: string;
  file_path?: string;
  line_range?: { start: number; end: number };
  attachment_id?: string;
  url?: string;
  raw_hash: string;
  quote: string;
}

export type SignalConfidence = "direct" | "paraphrased" | "inferred" | "speculative";

export interface Entity {
  slug: string;
  name: string;
  type: "person" | "project" | "organization" | "tool" | "concept";
  context: string;
  confidence: SignalConfidence;
}

export interface TimelineEntry {
  date: string; // ISO 8601 date or partial date
  summary: string;
  entities: string[]; // slugs
  source: SourceRef;
  confidence: SignalConfidence;
}

export type LinkType =
  | "works_on"
  | "works_at"
  | "reports_to"
  | "collaborates"
  | "depends_on"
  | "mentions"
  | "approves"
  | "uses"
  | "custom";

export interface Link {
  from: string; // entity slug
  to: string; // entity slug
  type: LinkType;
  context: string;
  confidence: SignalConfidence;
  source: SourceRef;
}

export interface Decision {
  summary: string;
  reasoning?: string;
  alternatives?: string[];
  entities: string[]; // slugs
  date: string; // ISO 8601
  valid_at?: string; // ISO 8601
  invalid_at?: string; // ISO 8601
  confidence: SignalConfidence;
  source: SourceRef;
}

export interface TaskSignal {
  title: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  owner?: string;
  project?: string;
  due_date?: string; // ISO 8601
  valid_at?: string; // ISO 8601
  invalid_at?: string; // ISO 8601
  source: SourceRef;
  confidence: SignalConfidence;
}

export interface Discovery {
  summary: string;
  detail?: string;
  type: "procedure" | "preference" | "pattern" | "insight" | "risk";
  entities: string[]; // slugs
  source: SourceRef;
  confidence: SignalConfidence;
}

export type KnowledgeSourceType = "conversation" | "document" | "teaching";

export interface Knowledge {
  topic: string;
  content: string;
  source_type: KnowledgeSourceType;
  related_entities: string[];
  valid_at?: string;
  invalid_at?: string;
  source: SourceRef;
  confidence: SignalConfidence;
}

export interface ExtractionResult {
  source: SourceRef;
  entities: Entity[];
  timeline: TimelineEntry[];
  links: Link[];
  decisions: Decision[];
  tasks: TaskSignal[];
  discoveries: Discovery[];
  knowledge: Knowledge[];
  personAliases?: Record<string, string[]>;
}

export interface SignificanceVerdict {
  worth_processing: boolean;
  reason: string;
  topics: string[];
  confidence: number; // 0.0 to 1.0
}

export type BlockResult =
  | { status: "ok"; data: ExtractionResult }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface Collector {
  id: string;
  name: string;
  description: string;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  fetch(opts: FetchOpts): AsyncGenerator<RawMessage>;
}

export interface CursorProvider {
  getCommittableCursors(): Record<string, unknown>;
  discardSource(sourceName: string): void;
}

export interface Formatter {
  id: string;
  format(result: ExtractionResult): string | Buffer;
}

export interface AdapterPushResult {
  written: number;
  skipped: number;
  errors: Array<{ signal: string; reason: string }>;
}

export interface Adapter {
  id: string;
  name: string;
  description: string;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
  push(results: ExtractionResult[]): Promise<AdapterPushResult>;
}

export interface DedupEntry {
  source_hash: string;
  content_hash: string;
}

export type SourceType = "email" | "chat" | "dm" | "document" | "structured";

export type InteractionTag = "sent" | "reply" | "dm";

export interface CanonicalisedBlock {
  block: ConversationBlock;
  source_type: SourceType;
  interaction_tags: InteractionTag[];
  canonical_markdown: string;
}

export interface SignalScore {
  token_score: number;
  unique_words_score: number;
  source_score: number;
  interaction_score: number;
  entity_density_score: number;
  combined: number;
  decision: "admit" | "drop" | "evaluate";
  /** Populated when decision === "drop"; omitted otherwise. */
  drop_reason?: string;
}

export interface QuickEntity {
  type: "email" | "url" | "handle" | "hashtag" | "phone" | "ticket_id";
  value: string;
}

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

export type SourceType =
  | "dm"
  | "group"
  | "email"
  | "document"
  | "calendar"
  | "task"
  | "agent_session"
  | "meeting"
  | "structured"
  | "chat"
  | (string & {});

export interface SourceParticipant {
  id?: string;
  name: string;
  role?: "author" | "sender" | "recipient" | "participant";
}

export interface SourceRefCore {
  platform: string;
  channel: string;
  timestamp: string; // ISO 8601
  raw_hash: string;
  quote: string;
}

export interface SourceRef extends SourceRefCore {
  source_type?: SourceType;
  channel_name?: string;
  start_time?: string;
  end_time?: string;
  external_id?: string;
  message_id?: string;
  message_ids?: string[];
  thread_id?: string;
  conversation_id?: string;
  author?: SourceParticipant;
  participants?: SourceParticipant[];
  account_id?: string;
  tenant_id?: string;
  file_path?: string;
  line_range?: { start: number; end: number };
  attachment_id?: string;
  url?: string;
  sensitivity?: "normal" | "high";
  metadata?: Record<string, unknown>;
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
  | "part_of"
  | "precedes"
  | "next"
  | "escalates_to"
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
  type: "procedure" | "pattern" | "insight" | "risk";
  entities: string[]; // slugs
  source: SourceRef;
  confidence: SignalConfidence;
}

export interface Preference {
  summary: string; // "偏好异步沟通，不喜欢临时会议"
  detail?: string;
  category: "communication" | "tooling" | "scheduling" | "workflow" | "other";
  entities: string[]; // slugs, usually a person
  source: SourceRef;
  confidence: SignalConfidence;
}

export interface Reference {
  title: string; // 文档标题
  url: string; // 核心字段
  summary: string; // ≤100 字摘要
  trigger?: string; // "遇到 Claude 安装问题时查阅"
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
  preferences: Preference[];
  references: Reference[];
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

export interface MemoryFilter {
  platform?: string | string[];
  source_type?: string | string[];
  channel?: string;
  channel_name?: string;
  participant?: string;
  from?: string;
  to?: string;
  type?: string[];
  exclude_types?: string[];
  limit?: number;
}

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

export interface FeishuMessageSourceConfig {
  enabled: boolean;
  chat_ids?: string[];
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
}

export interface FeishuCalendarSourceConfig {
  enabled: boolean;
  calendar_ids: string[];
}

export interface FeishuDocSourceConfig {
  enabled: boolean;
  my_space?: { enabled?: boolean; max_depth?: number };
  wiki?: { enabled?: boolean; exclude_space_ids?: string[] };
  folders?: Array<{ token: string; name: string }>;
  gate?: { min_content_chars?: number };
  triggers?: {
    self_edit?: boolean;
    recent_window_days?: number | null;
    important_folders?: string[];
    important_wiki_spaces?: string[];
  };
  refresh?: { on_hash_change?: boolean; cold_refresh_days?: number | null };
  upgrade_queue?: {
    batch_size?: number;
    bootstrap_batch_size?: number;
    bootstrap_runs?: number;
    max_pending?: number;
  };
  llm?: { model?: string; qps?: number };
  self_open_id?: string | null;
}

export interface FeishuTaskSourceConfig {
  enabled: boolean;
}

export interface FeishuDMSourceConfig {
  enabled: boolean;
  dm_chat_ids?: string[];
  self_open_id?: string;
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
}

export interface FeishuMessageSearchSourceConfig {
  enabled: boolean;
  chat_types?: Array<"p2p" | "group">;
  query?: string;
  sender_type?: "user" | "bot";
  exclude_sender_type?: "user" | "bot";
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
  page_size?: number;
}

export interface FeishuMailSourceConfig {
  enabled: boolean;
  lookback_days?: number;
  override_since_ms?: number;
  overlap_ms?: number;
  fetch_concurrency?: number;
}

export interface FeishuCollectorConfig {
  auth_mode?: "bot" | "user";
  app_id: string;
  app_secret: string;
  lark_bin?: string;
  base_url?: string;
  rate_limit_qps?: number;
  auto_include_new_groups?: boolean;
  sources: {
    messages?: FeishuMessageSourceConfig;
    calendar?: FeishuCalendarSourceConfig;
    docs?: FeishuDocSourceConfig;
    tasks?: FeishuTaskSourceConfig;
    dm?: FeishuDMSourceConfig;
    message_search?: FeishuMessageSearchSourceConfig;
    mail?: FeishuMailSourceConfig;
  };
}

export interface FeishuCheckpoint {
  messages?: Record<string, { last_sync_at: number }>;
  dm?: Record<string, { last_sync_at: number }>;
  message_search?: Record<string, { last_sync_at: number }>;
  calendar?: Record<string, { sync_token: string }>;
  docs?: Record<string, { last_edit_time: number }>;
  tasks?: Record<string, { last_update_time: number }>;
  mail?: Record<string, { last_sync_at: number }>;
}

export type SourceCheckpoint = Record<string, Record<string, unknown>>;

export interface FeishuApiResponse<T> {
  code: number;
  msg: string;
  data?: T;
}

export interface FeishuTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

export interface FeishuPagedData<T> {
  items: T[];
  has_more: boolean;
  page_token?: string;
}

export interface FeishuMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  create_time: string;
  update_time?: string;
  chat_id: string;
  msg_type: string;
  body?: { content: string };
  sender: {
    id: string;
    id_type: string;
    sender_type: string;
    tenant_key?: string;
  };
  mentions?: Array<{
    key: string;
    id: { open_id: string; union_id?: string };
    name: string;
  }>;
}

export interface FeishuCalendarEvent {
  event_id: string;
  summary: string;
  description?: string;
  start_time: { timestamp?: string; date?: string };
  end_time: { timestamp?: string; date?: string };
  organizer?: { open_id?: string; display_name?: string };
  attendees?: Array<{
    type: string;
    user_id?: string;
    display_name?: string;
    rsvp_status?: string;
  }>;
  location?: { name?: string };
  status?: string;
  recurrence?: string;
  vchat?: { meeting_url?: string };
}

export interface FeishuCalendarSyncData {
  items: FeishuCalendarEvent[];
  has_more: boolean;
  page_token?: string;
  sync_token?: string;
}

export interface FeishuDriveFile {
  token: string;
  name: string;
  type: string;
  url: string;
  owner_id: string;
  created_time: string;
  modified_time: string;
  edit_users?: Array<{ open_id: string }>;
}

export interface FeishuTask {
  guid: string;
  summary: string;
  description?: string;
  creator?: { id: string; type: string };
  due?: { timestamp: string; is_all_day?: boolean };
  completed_at?: string;
  updated_at: string;
  created_at: string;
  members?: Array<{ id: string; type: string; role: string }>;
  url?: string;
  priority?: string;
}

export interface FeishuMailMessage {
  message_id: string;
  subject: string;
  from: string;
  to?: string[];
  cc?: string[];
  date: string;
  thread_id?: string;
  body?: string;
  attachments?: Array<{ file_name: string; size?: number }>;
}

export class FeishuAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeishuAuthError";
  }
}

export class FeishuApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public apiCode?: number,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}

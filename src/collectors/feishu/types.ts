export interface FeishuMessageSourceConfig {
  enabled: boolean;
  chat_ids: string[];
  lookback_days?: number;
  overlap_ms?: number;
}

export interface FeishuCalendarSourceConfig {
  enabled: boolean;
  calendar_ids: string[];
}

export interface FeishuCollectorConfig {
  app_id: string;
  app_secret: string;
  base_url?: string;
  rate_limit_qps?: number;
  sources: {
    messages?: FeishuMessageSourceConfig;
    calendar?: FeishuCalendarSourceConfig;
  };
}

export interface FeishuCheckpoint {
  messages?: Record<string, { last_sync_at: number }>;
  dm?: Record<string, { last_sync_at: number }>;
  calendar?: Record<string, { sync_token: string }>;
  docs?: Record<string, { last_edit_time: number }>;
  tasks?: Record<string, { last_update_time: number }>;
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
  content: string;
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

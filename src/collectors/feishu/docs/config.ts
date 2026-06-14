import type { FeishuDocSourceConfig } from "../types.js";

export interface ResolvedDocsConfig {
  my_space: { enabled: boolean; max_depth: number };
  wiki: { enabled: boolean; exclude_space_ids: string[] };
  folders: Array<{ token: string; name: string }>;
  gate: { min_content_chars: number };
  triggers: {
    self_edit: boolean;
    recent_window_days: number | null;
    important_folders: string[];
    important_wiki_spaces: string[];
  };
  refresh: { on_hash_change: boolean; cold_refresh_days: number | null };
  upgrade_queue: {
    batch_size: number;
    bootstrap_batch_size: number;
    bootstrap_runs: number;
    max_pending: number;
  };
  llm: { model: string | null; qps: number };
  self_open_id: string | null;
}

export function normalizeDocsConfig(raw: FeishuDocSourceConfig): ResolvedDocsConfig {
  return {
    my_space: { enabled: raw.my_space?.enabled ?? true, max_depth: raw.my_space?.max_depth ?? 10 },
    wiki: {
      enabled: raw.wiki?.enabled ?? true,
      exclude_space_ids: raw.wiki?.exclude_space_ids ?? [],
    },
    folders: raw.folders ?? [],
    gate: { min_content_chars: raw.gate?.min_content_chars ?? 200 },
    triggers: {
      self_edit: raw.triggers?.self_edit ?? true,
      recent_window_days: raw.triggers?.recent_window_days ?? null,
      important_folders: raw.triggers?.important_folders ?? [],
      important_wiki_spaces: raw.triggers?.important_wiki_spaces ?? [],
    },
    refresh: {
      on_hash_change: raw.refresh?.on_hash_change ?? true,
      cold_refresh_days: raw.refresh?.cold_refresh_days ?? null,
    },
    upgrade_queue: {
      batch_size: raw.upgrade_queue?.batch_size ?? 20,
      bootstrap_batch_size: raw.upgrade_queue?.bootstrap_batch_size ?? 50,
      bootstrap_runs: raw.upgrade_queue?.bootstrap_runs ?? 5,
      max_pending: raw.upgrade_queue?.max_pending ?? 5000,
    },
    llm: { model: raw.llm?.model ?? null, qps: raw.llm?.qps ?? 2 },
    self_open_id: raw.self_open_id ?? null,
  };
}

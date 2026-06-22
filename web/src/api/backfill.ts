// Types copied from src/server/backfill-job.ts (type-only, no runtime dependency)
export type BackfillSourceType = "dm" | "messages" | "mail" | "message_search";
export type BackfillState = "idle" | "running" | "done" | "error";

export interface SourceProgress {
  source: BackfillSourceType;
  processed: number;
  blocks: number;
  status: "pending" | "running" | "done" | "error" | "skipped";
  error?: string;
}

export interface BackfillStatus {
  state: BackfillState;
  sources: SourceProgress[];
  started_at?: number;
  finished_at?: number;
  error?: string;
  total_messages: number;
  total_blocks: number;
}

export interface CoverageBucket {
  week_start: number;
  count: number;
}

const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const backfillApi = {
  getStatus(): Promise<BackfillStatus> {
    return fetchJSON("/backfill/status");
  },

  start(sinceMs: number, sourceTypes: BackfillSourceType[]): Promise<{ started: boolean }> {
    return fetchJSON("/backfill/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since_ms: sinceMs, source_types: sourceTypes }),
    });
  },

  cancel(): Promise<{ ok: boolean }> {
    return fetchJSON("/backfill/cancel", { method: "POST" });
  },

  reset(): Promise<{ ok: boolean }> {
    return fetchJSON("/backfill/reset", { method: "POST" });
  },

  getCoverage(): Promise<{ buckets: CoverageBucket[] }> {
    return fetchJSON("/backfill/coverage");
  },
};

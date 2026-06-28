import { randomUUID } from "node:crypto";
import type { ChatNameResolver } from "../collectors/feishu/chat-name-resolver.js";
import type { SqlConn } from "../store/sql-executor.js";

export interface RefreshError {
  channel: string;
  error: string;
}

export type RefreshState = "idle" | "running" | "done" | "error";

export interface RefreshStatus {
  jobId: string | null;
  state: RefreshState;
  total: number;
  resolved: number;
  failed: number;
  skipped: number;
  currentChannel: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  errors: RefreshError[];
  lastRefreshedAt: string | null;
}

const MAX_ERRORS = 50;

export class ChatNameRefreshJob {
  private status: RefreshStatus = {
    jobId: null,
    state: "idle",
    total: 0,
    resolved: 0,
    failed: 0,
    skipped: 0,
    currentChannel: null,
    startedAt: null,
    finishedAt: null,
    errors: [],
    lastRefreshedAt: null,
  };
  private donePromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly pg: SqlConn,
    private readonly resolver: ChatNameResolver,
  ) {}

  getStatus(): RefreshStatus {
    return { ...this.status, errors: [...this.status.errors] };
  }

  async waitUntilDone(): Promise<void> {
    await this.donePromise;
  }

  async start(): Promise<string> {
    if (this.status.state === "running") {
      throw new Error("another refresh is in progress");
    }
    // Claim the slot synchronously before the await on collectChannels to
    // prevent a TOCTOU race if two callers reach start() concurrently.
    this.status.state = "running";
    try {
      const channels = await this.collectChannels();
      const jobId = randomUUID();
      this.status = {
        jobId,
        state: "running",
        total: channels.length,
        resolved: 0,
        failed: 0,
        skipped: 0,
        currentChannel: null,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        errors: [],
        // preserve lastRefreshedAt from the previous run so callers can still
        // read "when was the last successful sweep" while a new one is in flight
        lastRefreshedAt: this.status.lastRefreshedAt,
      };
      this.donePromise = this.runLoop(channels).catch((err) => {
        this.status.state = "error";
        this.status.finishedAt = new Date().toISOString();
        this.status.errors.push({
          channel: "<job>",
          error: err instanceof Error ? err.message : String(err),
        });
      });
      return jobId;
    } catch (err) {
      // collectChannels threw — revert the claim so future starts can proceed.
      this.status.state = "idle";
      throw err;
    }
  }

  private async runLoop(channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.status.currentChannel = channel;
      const outcome = await this.resolver.refresh(channel);
      switch (outcome.kind) {
        case "resolved":
          this.status.resolved += 1;
          break;
        case "skipped":
          this.status.skipped += 1;
          break;
        case "failed":
          this.status.failed += 1;
          break;
        case "transient_error":
          if (this.status.errors.length < MAX_ERRORS) {
            this.status.errors.push({ channel, error: outcome.error });
          }
          break;
      }
    }
    this.status.currentChannel = null;
    this.status.state = "done";
    this.status.finishedAt = new Date().toISOString();
    this.status.lastRefreshedAt = this.status.finishedAt;
  }

  async collectChannels(): Promise<string[]> {
    const sql = `
      SELECT DISTINCT channel FROM (
        SELECT COALESCE(
                 frontmatter->'source'->>'channel',
                 frontmatter->'first_seen'->>'channel'
               ) AS channel,
               COALESCE(
                 frontmatter->'source'->>'platform',
                 frontmatter->'first_seen'->>'platform'
               ) AS platform
        FROM pages
        WHERE COALESCE(
                frontmatter->'source'->>'platform',
                frontmatter->'first_seen'->>'platform'
              ) = 'feishu'
      ) t
      WHERE channel LIKE 'group/%' OR channel LIKE 'dm/%'
    `;
    const rows = await this.pg.query<{ channel: string }>(sql);
    return rows.rows.map((r) => r.channel);
  }
}

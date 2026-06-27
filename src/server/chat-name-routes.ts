import type { Hono } from "hono";
import type { StoreContext } from "./api.js";

/**
 * Registers two chat-name endpoints on the given Hono app:
 *   POST /api/feishu/refresh-chat-names         — start an async refresh job
 *   GET  /api/feishu/refresh-chat-names/status  — poll the current job state
 *
 * Both endpoints handle the case where ChatNameRefreshJob is undefined
 * (feishu source disabled): refresh returns 503, status returns an idle
 * placeholder so the frontend can render "feishu not configured" cleanly.
 */
export function registerChatNameRoutes(app: Hono, stores: StoreContext): void {
  const job = stores.chatNameRefreshJob;

  app.post("/api/feishu/refresh-chat-names", async (c) => {
    if (!job) {
      return c.json({ error: "feishu source is not enabled" }, 503);
    }
    try {
      const jobId = await job.start();
      return c.json({ jobId }, 202);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/in progress/i.test(msg)) {
        // Frontend will follow up with GET /status to attach to the running job.
        return c.json({ error: "another refresh is in progress" }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  app.get("/api/feishu/refresh-chat-names/status", (c) => {
    if (!job) {
      return c.json(
        {
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
        },
        200,
      );
    }
    return c.json(job.getStatus(), 200);
  });

  app.post("/api/feishu/channel-names", async (c) => {
    const body: { channels?: unknown } = await c.req
      .json<{ channels?: unknown }>()
      .catch(() => ({}));
    if (!Array.isArray(body.channels)) {
      return c.json({ error: "channels must be an array of strings" }, 400);
    }
    if (body.channels.length > 100) {
      return c.json({ error: "channels exceeds limit: at most 100 per request" }, 400);
    }
    const channels = body.channels.filter((x: unknown): x is string => typeof x === "string");
    const rows = await stores.db.executor.query<{
      external_id: string;
      display_name: string | null;
      resolved_at: string;
    }>(
      `SELECT external_id, display_name, resolved_at FROM identity_cache
       WHERE platform = 'feishu:chat' AND external_id = ANY($1::text[])`,
      [channels],
    );
    const map = new Map(rows.rows.map((r) => [r.external_id, r]));
    const results: Record<string, { display_name: string | null; status: string }> = {};
    for (const channel of channels) {
      if (channel.startsWith("mail/")) {
        results[channel] = { display_name: null, status: "mail" };
        continue;
      }
      const row = map.get(channel);
      if (!row) {
        results[channel] = { display_name: null, status: "unresolved" };
      } else if (row.display_name !== null) {
        results[channel] = { display_name: row.display_name, status: "resolved" };
      } else {
        results[channel] = { display_name: null, status: "failed" };
      }
    }
    return c.json({ results }, 200);
  });
}

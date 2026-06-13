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
}

import { describe, expect, it, vi } from "vitest";
import { createBackfillRoutes } from "./backfill-routes.js";
import { BackfillJob } from "./backfill-job.js";
import type { BackfillStatus } from "./backfill-job.js";

function makeJob(overrides: Partial<BackfillStatus> = {}): BackfillJob {
  const status: BackfillStatus = {
    state: "idle",
    sources: [],
    total_messages: 0,
    total_blocks: 0,
    ...overrides,
  };
  const job = new BackfillJob(vi.fn());
  vi.spyOn(job, "getStatus").mockReturnValue(status);
  return job;
}

function makeStores() {
  return {
    db: {
      pg: {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      },
    },
  } as never;
}

describe("backfill routes", () => {
  describe("GET /api/backfill/status", () => {
    it("returns current job status", async () => {
      const job = makeJob({ state: "idle", total_messages: 0, total_blocks: 0 });
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/status");
      expect(res.status).toBe(200);
      const body = (await res.json()) as BackfillStatus;
      expect(body.state).toBe("idle");
    });
  });

  describe("POST /api/backfill/start", () => {
    it("returns 400 when since_ms is missing", async () => {
      const job = makeJob();
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_types: ["dm"] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 when source_types is missing or empty", async () => {
      const job = makeJob();
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 1000 }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 when job is already running", async () => {
      const job = makeJob({ state: "running" });
      vi.spyOn(job, "start");
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 1000, source_types: ["dm"] }),
      });
      expect(res.status).toBe(409);
      expect(job.start).not.toHaveBeenCalled();
    });

    it("calls job.start and returns 202 when idle", async () => {
      const job = makeJob({ state: "idle" });
      vi.spyOn(job, "start");
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since_ms: 500_000, source_types: ["dm", "mail"] }),
      });
      expect(res.status).toBe(202);
      expect(job.start).toHaveBeenCalledWith(
        expect.objectContaining({ since_ms: 500_000, source_types: ["dm", "mail"] }),
      );
    });
  });

  describe("POST /api/backfill/cancel", () => {
    it("calls job.cancel and returns 200", async () => {
      const job = makeJob();
      vi.spyOn(job, "cancel");
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/cancel", { method: "POST" });
      expect(res.status).toBe(200);
      expect(job.cancel).toHaveBeenCalled();
    });
  });

  describe("POST /api/backfill/reset", () => {
    it("calls job.reset and returns 200", async () => {
      const job = makeJob();
      vi.spyOn(job, "reset");
      const app = createBackfillRoutes(job, makeStores());
      const res = await app.request("/api/backfill/reset", { method: "POST" });
      expect(res.status).toBe(200);
      expect(job.reset).toHaveBeenCalled();
    });
  });

  describe("GET /api/backfill/coverage", () => {
    it("returns buckets array from DB query", async () => {
      const stores = {
        db: {
          pg: {
            query: vi.fn().mockResolvedValue({
              rows: [
                { week_start_ms: "1000000000000", count: 3 },
                { week_start_ms: "1000604800000", count: 7 },
              ],
            }),
          },
        },
      } as never;
      const app = createBackfillRoutes(makeJob(), stores);
      const res = await app.request("/api/backfill/coverage");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { buckets: Array<{ week_start: number; count: number }> };
      expect(body.buckets).toHaveLength(2);
      expect(body.buckets[0]).toEqual({ week_start: 1_000_000_000_000, count: 3 });
    });
  });
});

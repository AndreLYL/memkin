import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type {
  ChatNameResolver,
  ResolutionOutcome,
} from "../collectors/feishu/chat-name-resolver.js";
import { Database } from "../store/database.js";
import type { StoreContext } from "./api.js";
import { ChatNameRefreshJob } from "./chat-name-refresh-job.js";
import { registerChatNameRoutes } from "./chat-name-routes.js";

function makeResolver(): ChatNameResolver {
  return {
    refresh: async () => ({ kind: "resolved", name: "x" }) as ResolutionOutcome,
    resolve: async () => "x",
  } as unknown as ChatNameResolver;
}

async function makeAppWithJob() {
  const db = await Database.create(undefined, { embeddingDimensions: 768 });
  const job = new ChatNameRefreshJob(db.pg, makeResolver());
  const stores = { db, chatNameRefreshJob: job } as unknown as StoreContext;
  const app = new Hono();
  registerChatNameRoutes(app, stores);
  return { app, db, job };
}

async function makeAppWithoutJob() {
  const db = await Database.create(undefined, { embeddingDimensions: 768 });
  const stores = { db } as unknown as StoreContext;
  const app = new Hono();
  registerChatNameRoutes(app, stores);
  return { app, db };
}

describe("POST /api/feishu/refresh-chat-names", () => {
  it("returns 202 with jobId when starting fresh", async () => {
    const { app, db, job } = await makeAppWithJob();
    const res = await app.request("/api/feishu/refresh-chat-names", { method: "POST" });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string };
    expect(body.jobId).toMatch(/^[0-9a-f-]+$/);
    await job.waitUntilDone(); // drain background work
    await db.pg.close();
  });

  it("returns 503 when feishu source is not configured", async () => {
    const { app, db } = await makeAppWithoutJob();
    const res = await app.request("/api/feishu/refresh-chat-names", { method: "POST" });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not enabled/i);
    await db.pg.close();
  });

  it("returns 409 when another refresh is already running", async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    // Resolver that never resolves until we say so — keeps the job in 'running' state
    let resolveSlow!: () => void;
    const slowResolver = {
      refresh: vi.fn(
        () =>
          new Promise<ResolutionOutcome>((r) => {
            resolveSlow = () => r({ kind: "resolved", name: "x" } as ResolutionOutcome);
          }),
      ),
      resolve: vi.fn(),
    } as unknown as ChatNameResolver;
    // Need at least one feishu page so the channel collection finds something
    const fm = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_a" } });
    await db.pg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb)`,
      [fm],
    );
    const job = new ChatNameRefreshJob(db.pg, slowResolver);
    const stores = { db, chatNameRefreshJob: job } as unknown as StoreContext;
    const app = new Hono();
    registerChatNameRoutes(app, stores);

    const first = await app.request("/api/feishu/refresh-chat-names", { method: "POST" });
    expect(first.status).toBe(202);
    const second = await app.request("/api/feishu/refresh-chat-names", { method: "POST" });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/in progress/i);

    resolveSlow();
    await job.waitUntilDone();
    await db.pg.close();
  });
});

describe("GET /api/feishu/refresh-chat-names/status", () => {
  it("returns idle placeholder when feishu source is not configured", async () => {
    const { app, db } = await makeAppWithoutJob();
    const res = await app.request("/api/feishu/refresh-chat-names/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      state: string;
      jobId: string | null;
      total: number;
      errors: unknown[];
    };
    expect(body.state).toBe("idle");
    expect(body.jobId).toBeNull();
    expect(body.total).toBe(0);
    expect(body.errors).toEqual([]);
    await db.pg.close();
  });

  it("returns idle status before any job starts", async () => {
    const { app, db } = await makeAppWithJob();
    const res = await app.request("/api/feishu/refresh-chat-names/status");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { state: string; jobId: string | null };
    expect(body.state).toBe("idle");
    expect(body.jobId).toBeNull();
    await db.pg.close();
  });

  it("returns running then done status after a job runs to completion", async () => {
    const { app, db, job } = await makeAppWithJob();
    // Seed at least one feishu page so the job has work to do
    const fm = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_x" } });
    await db.pg.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb)`,
      [fm],
    );
    await app.request("/api/feishu/refresh-chat-names", { method: "POST" });
    await job.waitUntilDone();
    const res = await app.request("/api/feishu/refresh-chat-names/status");
    const body = (await res.json()) as { state: string; total: number; resolved: number };
    expect(body.state).toBe("done");
    expect(body.total).toBe(1);
    expect(body.resolved).toBe(1);
    await db.pg.close();
  });
});

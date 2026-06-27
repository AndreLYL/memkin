import { describe, expect, it, vi } from "vitest";
import type {
  ChatNameResolver,
  ResolutionOutcome,
} from "../collectors/feishu/chat-name-resolver.js";
import { Database } from "../store/database.js";
import { ChatNameRefreshJob } from "./chat-name-refresh-job.js";

async function freshDb() {
  return Database.create(undefined, { embeddingDimensions: 768 });
}

function makeResolver(map: Record<string, ResolutionOutcome>): ChatNameResolver {
  return {
    refresh: vi.fn(async (channel: string) => map[channel] ?? ({ kind: "failed" } as const)),
    resolve: vi.fn(),
  } as unknown as ChatNameResolver;
}

describe("ChatNameRefreshJob — idle initial state", () => {
  it("getStatus returns state=idle before any start", async () => {
    const db = await freshDb();
    const job = new ChatNameRefreshJob(db.executor, makeResolver({}));
    const status = job.getStatus();
    expect(status.state).toBe("idle");
    expect(status.jobId).toBeNull();
    expect(status.total).toBe(0);
    await db.executor.close();
  });
});

describe("ChatNameRefreshJob — channel collection", () => {
  it("collects distinct feishu channels from pages.frontmatter, excluding mail", async () => {
    const db = await freshDb();
    const insertPage = async (slug: string, channel: string, source = "source") => {
      const fm = JSON.stringify({ [source]: { platform: "feishu", channel } });
      await db.executor.query(
        `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter)
         VALUES ($1, 'task', 't', '', $2::jsonb)`,
        [slug, fm],
      );
    };
    await insertPage("p1", "group/oc_a");
    await insertPage("p2", "group/oc_a"); // duplicate
    await insertPage("p3", "dm/oc_b");
    await insertPage("p4", "mail/INBOX"); // should be excluded
    await insertPage("p5", "group/oc_c", "first_seen");

    const job = new ChatNameRefreshJob(db.executor, makeResolver({}));
    const channels = await job.collectChannels();
    expect(channels.sort()).toEqual(["dm/oc_b", "group/oc_a", "group/oc_c"]);
    await db.executor.close();
  });

  it("excludes non-feishu pages", async () => {
    const db = await freshDb();
    const fmFeishu = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_feishu" } });
    const fmClaude = JSON.stringify({
      source: { platform: "claude-code", channel: "group/oc_claude" },
    });
    await db.executor.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb), ('p2', 'task', 't', '', $2::jsonb)`,
      [fmFeishu, fmClaude],
    );
    const job = new ChatNameRefreshJob(db.executor, makeResolver({}));
    const channels = await job.collectChannels();
    expect(channels).toEqual(["group/oc_feishu"]);
    await db.executor.close();
  });
});

describe("ChatNameRefreshJob — start + run", () => {
  it("transitions through running → done and reports per-outcome counts", async () => {
    const db = await freshDb();
    const insertFeishuPage = async (slug: string, channel: string) => {
      const fm = JSON.stringify({ source: { platform: "feishu", channel } });
      await db.executor.query(
        `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ($1, 'task', 't', '', $2::jsonb)`,
        [slug, fm],
      );
    };
    await insertFeishuPage("p1", "group/oc_a");
    await insertFeishuPage("p2", "group/oc_b");
    await insertFeishuPage("p3", "group/oc_c");

    const resolver = makeResolver({
      "group/oc_a": { kind: "resolved", name: "群A" },
      "group/oc_b": { kind: "failed" },
      "group/oc_c": { kind: "transient_error", error: "network" },
    });
    const job = new ChatNameRefreshJob(db.executor, resolver);
    const jobId = await job.start();
    expect(jobId).toBeTruthy();
    await job.waitUntilDone();
    const s = job.getStatus();
    expect(s.state).toBe("done");
    expect(s.resolved).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]?.channel).toBe("group/oc_c");
    expect(s.errors[0]?.error).toBe("network");
    expect(s.lastRefreshedAt).toBeTruthy();
    expect(s.finishedAt).toBeTruthy();
    await db.executor.close();
  });

  it("counts skipped outcomes (TTL cache hit)", async () => {
    const db = await freshDb();
    const fm = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_cached" } });
    await db.executor.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb)`,
      [fm],
    );
    const resolver = makeResolver({
      "group/oc_cached": { kind: "skipped", name: "已缓存" },
    });
    const job = new ChatNameRefreshJob(db.executor, resolver);
    await job.start();
    await job.waitUntilDone();
    const s = job.getStatus();
    expect(s.skipped).toBe(1);
    expect(s.resolved).toBe(0);
    await db.executor.close();
  });

  it("rejects concurrent start with throw, status still attachable", async () => {
    const db = await freshDb();
    const fm = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_a" } });
    await db.executor.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb)`,
      [fm],
    );

    let resolveSlow!: () => void;
    const slowResolver = {
      refresh: vi.fn(
        () =>
          new Promise<ResolutionOutcome>((r) => {
            resolveSlow = () => r({ kind: "resolved", name: "x" });
          }),
      ),
      resolve: vi.fn(),
    } as unknown as ChatNameResolver;

    const job = new ChatNameRefreshJob(db.executor, slowResolver);
    const first = await job.start();
    expect(first).toBeTruthy();
    expect(job.getStatus().state).toBe("running");

    await expect(job.start()).rejects.toThrow(/in progress/i);
    const attached = job.getStatus();
    expect(attached.state).toBe("running");
    expect(attached.jobId).toBe(first);

    resolveSlow();
    await job.waitUntilDone();
    await db.executor.close();
  });

  it("caps errors at 50 to avoid runaway memory", async () => {
    const db = await freshDb();
    // Insert 60 distinct feishu channels
    for (let i = 0; i < 60; i++) {
      const fm = JSON.stringify({ source: { platform: "feishu", channel: `group/oc_${i}` } });
      await db.executor.query(
        `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ($1, 'task', 't', '', $2::jsonb)`,
        [`p${i}`, fm],
      );
    }
    // Resolver returns transient_error for everything
    const resolver = {
      refresh: vi.fn(async () => ({ kind: "transient_error" as const, error: "boom" })),
      resolve: vi.fn(),
    } as unknown as ChatNameResolver;
    const job = new ChatNameRefreshJob(db.executor, resolver);
    await job.start();
    await job.waitUntilDone();
    const s = job.getStatus();
    expect(s.errors).toHaveLength(50);
    expect(resolver.refresh).toHaveBeenCalledTimes(60); // refresh called for all 60
    await db.executor.close();
  });

  it("transitions to error state when runLoop throws unexpectedly", async () => {
    const db = await freshDb();
    const fm = JSON.stringify({ source: { platform: "feishu", channel: "group/oc_a" } });
    await db.executor.query(
      `INSERT INTO pages (slug, type, title, compiled_truth, frontmatter) VALUES ('p1', 'task', 't', '', $1::jsonb)`,
      [fm],
    );
    // Resolver rejects rather than returning a ResolutionOutcome
    const resolver = {
      refresh: vi.fn(async () => {
        throw new Error("unexpected runtime error");
      }),
      resolve: vi.fn(),
    } as unknown as ChatNameResolver;
    const job = new ChatNameRefreshJob(db.executor, resolver);
    await job.start();
    await job.waitUntilDone();
    const s = job.getStatus();
    expect(s.state).toBe("error");
    expect(s.errors).toHaveLength(1);
    expect(s.errors[0]?.channel).toBe("<job>");
    expect(s.errors[0]?.error).toContain("unexpected runtime error");
    expect(s.finishedAt).toBeTruthy();
    await db.executor.close();
  });
});

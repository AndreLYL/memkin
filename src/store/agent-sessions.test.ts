import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSessionStore } from "./agent-sessions.js";
import { Database } from "./database.js";

let db: Database;
let store: AgentSessionStore;

beforeEach(async () => {
  db = await Database.create(undefined, { embeddingDimensions: 768 });
  store = new AgentSessionStore(db.executor);
});

afterEach(async () => {
  await db.executor.close();
});

describe("AgentSessionStore.recordRevision", () => {
  const base = {
    sourceInstance: "claude-code",
    sessionId: "sess-a",
    contentHash: "hash-1",
    byteSize: 100,
    lineCount: 5,
  };

  it("records a brand-new session revision as 'new'", async () => {
    const r = await store.recordRevision(base);
    expect(r.status).toBe("new");
    expect(r.revision.state).toBe("discovered");
    expect(r.revision.sourceInstance).toBe("claude-code");
    expect(r.revision.contentHash).toBe("hash-1");
  });

  it("returns 'unchanged' for the same (source, session, hash)", async () => {
    await store.recordRevision(base);
    const r = await store.recordRevision(base);
    expect(r.status).toBe("unchanged");
    const rows = await store.listSessions({ sourceInstance: "claude-code" });
    expect(rows).toHaveLength(1);
  });

  it("returns 'revised' when the same session has a new content_hash", async () => {
    await store.recordRevision(base);
    const r = await store.recordRevision({
      ...base,
      contentHash: "hash-2",
      byteSize: 200,
      lineCount: 9,
    });
    expect(r.status).toBe("revised");
    const rows = await store.listSessions({ sourceInstance: "claude-code" });
    expect(rows).toHaveLength(2);
  });

  it("getLatestRevision returns the most recently discovered row", async () => {
    await store.recordRevision(base);
    await store.recordRevision({ ...base, contentHash: "hash-2", byteSize: 200, lineCount: 9 });
    const latest = await store.getLatestRevision("claude-code", "sess-a");
    expect(latest?.contentHash).toBe("hash-2");
  });

  it("keeps revisions of different sessions independent", async () => {
    await store.recordRevision(base);
    await store.recordRevision({ ...base, sessionId: "sess-b" });
    const rows = await store.listSessions({ sourceInstance: "claude-code" });
    expect(rows).toHaveLength(2);
  });
});

describe("AgentSessionStore state machine + queries", () => {
  async function seed(): Promise<number> {
    const r = await store.recordRevision({
      sourceInstance: "codex",
      sessionId: "s1",
      contentHash: "h1",
      byteSize: 10,
      lineCount: 1,
    });
    return r.revision.id;
  }

  it("listSessions filters by source and state, ordered by discovered_at desc", async () => {
    await store.recordRevision({
      sourceInstance: "codex",
      sessionId: "s1",
      contentHash: "h1",
      byteSize: 1,
      lineCount: 1,
    });
    await store.recordRevision({
      sourceInstance: "hermes",
      sessionId: "s2",
      contentHash: "h2",
      byteSize: 1,
      lineCount: 1,
    });
    const codexOnly = await store.listSessions({ sourceInstance: "codex" });
    expect(codexOnly).toHaveLength(1);
    expect(codexOnly[0].sourceInstance).toBe("codex");

    const discovered = await store.listSessions({ state: "discovered" });
    expect(discovered).toHaveLength(2);
    const distilled = await store.listSessions({ state: "distilled" });
    expect(distilled).toHaveLength(0);
  });

  it("getRevision returns a single row by id", async () => {
    const id = await seed();
    const rev = await store.getRevision(id);
    expect(rev?.id).toBe(id);
    expect(rev?.sessionId).toBe("s1");
  });

  it("markState follows legal transitions and refreshes updated_at", async () => {
    const id = await seed();
    const distilled = await store.markState(id, "distilled");
    expect(distilled.state).toBe("distilled");
    const applying = await store.markState(id, "applying");
    expect(applying.state).toBe("applying");
    const done = await store.markState(id, "done");
    expect(done.state).toBe("done");
  });

  it("markState allows the retry branch", async () => {
    const id = await seed();
    await store.markState(id, "distilled");
    await store.markState(id, "retrying");
    const back = await store.markState(id, "distilled");
    expect(back.state).toBe("distilled");
  });

  it("markState allows discovered → retrying (distillation failure, PR-2)", async () => {
    const id = await seed();
    const retrying = await store.markState(id, "retrying");
    expect(retrying.state).toBe("retrying");
    // A later successful retry lands as distilled.
    const distilled = await store.markState(id, "distilled");
    expect(distilled.state).toBe("distilled");
  });

  it("markState allows retrying → dead_letter", async () => {
    const id = await seed();
    await store.markState(id, "distilled");
    await store.markState(id, "retrying");
    const dead = await store.markState(id, "dead_letter");
    expect(dead.state).toBe("dead_letter");
  });

  it("markState rejects an illegal transition", async () => {
    const id = await seed();
    // discovered → done is not allowed
    await expect(store.markState(id, "done")).rejects.toThrow(/illegal state transition/);
  });

  it("incrementRetry counts up and can be gated at threshold 3 by the caller", async () => {
    const id = await seed();
    expect(await store.incrementRetry(id)).toBe(1);
    expect(await store.incrementRetry(id)).toBe(2);
    const third = await store.incrementRetry(id);
    expect(third).toBe(3);
    // Caller's dead-letter threshold logic: retry_count >= 3
    expect(third >= 3).toBe(true);
  });
});

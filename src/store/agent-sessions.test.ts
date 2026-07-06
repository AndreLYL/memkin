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

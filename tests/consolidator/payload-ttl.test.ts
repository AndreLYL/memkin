import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Consolidator, type ConsolidatorStores } from "../../src/consolidator/consolidator.js";
import type { DistilledPayload } from "../../src/distiller/contract.js";
import { AgentSessionStore } from "../../src/store/agent-sessions.js";
import { Database } from "../../src/store/database.js";
import { DistilledPayloadStore } from "../../src/store/distilled-payload.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

function samplePayload(): DistilledPayload {
  return {
    signals: [
      {
        type: "decision",
        topic: "t",
        what: "w",
        entities: [],
        authority: "user_confirmed",
        evidence: [{ start: "msg-1", end: "msg-1" }],
        persistence_reason: "r",
      },
    ],
  };
}

describe("Consolidator — distilled payload TTL cleanup hook (spec §4.3)", () => {
  let db: Database;
  let stores: ConsolidatorStores;
  let sessions: AgentSessionStore;
  let payloads: DistilledPayloadStore;

  beforeEach(async () => {
    db = await Database.create();
    stores = {
      pages: new PageStore(db.executor),
      graph: new GraphStore(db.executor),
      tags: new TagStore(db.executor),
      timeline: new TimelineStore(db.executor),
    };
    sessions = new AgentSessionStore(db.executor);
    payloads = new DistilledPayloadStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("stamps TTL for done sessions and sweeps expired payloads during runOnce", async () => {
    // A done session whose payload TTL will be stamped.
    const rec = await sessions.recordRevision({
      sourceInstance: "claude-code",
      sessionId: "s1",
      contentHash: "h1",
      byteSize: 1,
      lineCount: 1,
    });
    const stored = await payloads.persist({
      sourceInstance: "claude-code",
      sessionId: "s1",
      revisionId: rec.revision.id,
      contentHash: "h1",
      payload: samplePayload(),
      restorationMap: {},
    });
    await sessions.markState(rec.revision.id, "applying");
    await sessions.markState(rec.revision.id, "done");

    // A second, already-expired payload that must be swept.
    const rec2 = await sessions.recordRevision({
      sourceInstance: "claude-code",
      sessionId: "s2",
      contentHash: "h2",
      byteSize: 1,
      lineCount: 1,
    });
    const stored2 = await payloads.persist({
      sourceInstance: "claude-code",
      sessionId: "s2",
      revisionId: rec2.revision.id,
      contentHash: "h2",
      payload: samplePayload(),
      restorationMap: {},
    });
    await payloads.setTtl(stored2.id, -1); // already past due

    const consolidator = new Consolidator(stores, undefined, undefined, {
      payloads,
      ttlDays: 90,
    });
    const result = await consolidator.runOnce("hot");

    expect(result.payloadsSwept).toBe(1);
    // The done session's payload got a future TTL stamped (not swept).
    const after = await payloads.getById(stored.id);
    expect(after?.ttlExpiresAt).toBeTruthy();
    // The expired one is gone.
    expect(await payloads.getById(stored2.id)).toBeNull();
  });

  it("does nothing in dry-run mode", async () => {
    const rec = await sessions.recordRevision({
      sourceInstance: "codex",
      sessionId: "s3",
      contentHash: "h3",
      byteSize: 1,
      lineCount: 1,
    });
    const stored = await payloads.persist({
      sourceInstance: "codex",
      sessionId: "s3",
      revisionId: rec.revision.id,
      contentHash: "h3",
      payload: samplePayload(),
      restorationMap: {},
    });
    await payloads.setTtl(stored.id, -1);

    const consolidator = new Consolidator(stores, undefined, undefined, {
      payloads,
      ttlDays: 90,
    });
    const result = await consolidator.runOnce("hot", true);
    expect(result.payloadsSwept).toBe(0);
    expect(await payloads.getById(stored.id)).not.toBeNull();
  });

  it("reports zero when the outbox hook is not wired", async () => {
    const consolidator = new Consolidator(stores);
    const result = await consolidator.runOnce("hot");
    expect(result.payloadsSwept).toBe(0);
  });
});

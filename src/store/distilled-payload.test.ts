import { describe, expect, it } from "vitest";
import type { DistilledPayload } from "../distiller/contract.js";
import { AgentSessionStore } from "./agent-sessions.js";
import { Database } from "./database.js";
import { DistilledPayloadStore } from "./distilled-payload.js";

function samplePayload(): DistilledPayload {
  return {
    signals: [
      {
        type: "decision",
        topic: "Adopt Bun",
        what: "Use Bun for the toolchain",
        entities: ["Bun"],
        authority: "user_confirmed",
        evidence: [{ start: "msg-1", end: "msg-2" }],
        persistence_reason: "durable stack decision",
      },
    ],
  };
}

async function setup() {
  const db = await Database.create(undefined, { embeddingDimensions: 768 });
  const sessions = new AgentSessionStore(db.executor);
  const store = new DistilledPayloadStore(db.executor);
  return { db, sessions, store };
}

describe("DistilledPayloadStore", () => {
  it("persists a payload and advances the ledger discovered→distilled", async () => {
    const { db, sessions, store } = await setup();
    try {
      const rec = await sessions.recordRevision({
        sourceInstance: "claude-code",
        sessionId: "sess-1",
        contentHash: "hash-a",
        byteSize: 100,
        lineCount: 3,
      });
      const revId = rec.revision.id;

      const saved = await store.persist({
        sourceInstance: "claude-code",
        sessionId: "sess-1",
        revisionId: revId,
        contentHash: "hash-a",
        payload: samplePayload(),
        restorationMap: {},
      });
      expect(saved.id).toBeGreaterThan(0);

      // Ledger advanced and payload_id linked.
      const rev = await sessions.getRevision(revId);
      expect(rev?.state).toBe("distilled");
      expect(rev?.payloadId).toBe(saved.id);

      // Fetch the payload back.
      const fetched = await store.getByRevision(revId);
      expect(fetched?.payload.signals[0].topic).toBe("Adopt Bun");
    } finally {
      await db.executor.close();
    }
  });

  it("is idempotent on the immutable revision (replay never re-inserts)", async () => {
    const { db, sessions, store } = await setup();
    try {
      const rec = await sessions.recordRevision({
        sourceInstance: "codex",
        sessionId: "sess-2",
        contentHash: "hash-b",
        byteSize: 10,
        lineCount: 1,
      });
      const revId = rec.revision.id;
      const a = await store.persist({
        sourceInstance: "codex",
        sessionId: "sess-2",
        revisionId: revId,
        contentHash: "hash-b",
        payload: samplePayload(),
        restorationMap: {},
      });
      const b = await store.persist({
        sourceInstance: "codex",
        sessionId: "sess-2",
        revisionId: revId,
        contentHash: "hash-b",
        payload: samplePayload(),
        restorationMap: {},
      });
      expect(b.id).toBe(a.id);
      const count = await db.executor.query<{ n: number }>(
        "SELECT COUNT(*)::int AS n FROM distilled_payload WHERE revision_id = $1",
        [revId],
      );
      expect(count.rows[0].n).toBe(1);
    } finally {
      await db.executor.close();
    }
  });

  it("setTtl stamps ttl_expires_at N days out and sweepExpired deletes past-due rows", async () => {
    const { db, sessions, store } = await setup();
    try {
      const rec = await sessions.recordRevision({
        sourceInstance: "hermes",
        sessionId: "sess-3",
        contentHash: "hash-c",
        byteSize: 10,
        lineCount: 1,
      });
      const saved = await store.persist({
        sourceInstance: "hermes",
        sessionId: "sess-3",
        revisionId: rec.revision.id,
        contentHash: "hash-c",
        payload: samplePayload(),
        restorationMap: { "msg-1": [{ original: "x", replacement: "[R]", position: 0 }] },
      });

      // TTL in the past → immediately sweepable.
      await store.setTtl(saved.id, -1);
      const swept = await store.sweepExpired();
      expect(swept).toBe(1);
      const gone = await store.getByRevision(rec.revision.id);
      expect(gone).toBeNull();
    } finally {
      await db.executor.close();
    }
  });

  it("stampTtlForDoneSessions stamps TTL only for payloads of done sessions without one", async () => {
    const { db, sessions, store } = await setup();
    try {
      // Session A reaches done; session B stays distilled.
      const a = await sessions.recordRevision({
        sourceInstance: "claude-code",
        sessionId: "sess-done",
        contentHash: "hash-e",
        byteSize: 10,
        lineCount: 1,
      });
      const b = await sessions.recordRevision({
        sourceInstance: "claude-code",
        sessionId: "sess-open",
        contentHash: "hash-f",
        byteSize: 10,
        lineCount: 1,
      });
      const pa = await store.persist({
        sourceInstance: "claude-code",
        sessionId: "sess-done",
        revisionId: a.revision.id,
        contentHash: "hash-e",
        payload: samplePayload(),
        restorationMap: {},
      });
      await store.persist({
        sourceInstance: "claude-code",
        sessionId: "sess-open",
        revisionId: b.revision.id,
        contentHash: "hash-f",
        payload: samplePayload(),
        restorationMap: {},
      });
      // Drive session A to done through the legal state machine.
      await sessions.markState(a.revision.id, "applying");
      await sessions.markState(a.revision.id, "done");

      const stamped = await store.stampTtlForDoneSessions(90);
      expect(stamped).toBe(1);

      const pAfter = await store.getById(pa.id);
      expect(pAfter?.ttlExpiresAt).toBeTruthy();
      const pOpen = await store.getByRevision(b.revision.id);
      expect(pOpen?.ttlExpiresAt).toBeNull();

      // Idempotent: second call stamps nothing new.
      const again = await store.stampTtlForDoneSessions(90);
      expect(again).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("does not sweep rows whose ttl is unset or in the future", async () => {
    const { db, sessions, store } = await setup();
    try {
      const rec = await sessions.recordRevision({
        sourceInstance: "hermes",
        sessionId: "sess-4",
        contentHash: "hash-d",
        byteSize: 10,
        lineCount: 1,
      });
      const saved = await store.persist({
        sourceInstance: "hermes",
        sessionId: "sess-4",
        revisionId: rec.revision.id,
        contentHash: "hash-d",
        payload: samplePayload(),
        restorationMap: {},
      });
      await store.setTtl(saved.id, 90); // future
      const swept = await store.sweepExpired();
      expect(swept).toBe(0);
    } finally {
      await db.executor.close();
    }
  });
});

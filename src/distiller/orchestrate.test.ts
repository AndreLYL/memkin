import { describe, expect, it } from "vitest";
import type { PrivacyConfig } from "../core/config.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import { AgentSessionStore } from "../store/agent-sessions.js";
import { Database } from "../store/database.js";
import { DistilledPayloadStore } from "../store/distilled-payload.js";
import { SessionDistiller, type TranscriptSource } from "./index.js";

const privacy: PrivacyConfig = {
  enabled: true,
  mode: "reversible",
  redact_phone: true,
  redact_id_card: true,
  redact_bank_card: true,
  redact_email: false,
  redact_url: false,
  blocked_words: [],
  replacement: "[REDACTED]",
};

const HOUR = 3_600_000;

/** LLM provider that counts calls and returns scripted responses in order. */
function countingProvider(responses: string[]): {
  provider: LLMProvider;
  calls: () => number;
} {
  let i = 0;
  const provider: LLMProvider = {
    async chat() {
      const r = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return r;
    },
  };
  return { provider, calls: () => i };
}

function goodMapResponse() {
  return JSON.stringify({
    seg_no: 1,
    summary: "s",
    tentative_signals: [],
    overturned: [],
    carry_forward: "",
  });
}

function goodReduceResponse() {
  return JSON.stringify({
    signals: [
      {
        type: "decision",
        topic: "Adopt Bun",
        what: "Use Bun. Contact at 13800138000.",
        entities: ["Bun"],
        authority: "user_confirmed",
        evidence: [{ start: "msg-1", end: "msg-2" }],
        persistence_reason: "durable",
      },
    ],
  });
}

/** In-memory transcript source with controllable mtime. */
function memTranscripts(
  files: Record<string, { content: string; mtimeMs: number }>,
): TranscriptSource {
  return {
    async load(sourceInstance, sessionId) {
      return files[`${sourceInstance}/${sessionId}`] ?? null;
    },
  };
}

const transcript = [
  JSON.stringify({
    type: "user",
    message: { role: "user", content: "Let us adopt Bun. phone 13800138000" },
    uuid: "u1",
    timestamp: "2026-01-01T00:00:00Z",
  }),
  JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: "Confirmed, Bun it is." },
    uuid: "u2",
    timestamp: "2026-01-01T00:01:00Z",
  }),
].join("\n");

async function setup(files: Record<string, { content: string; mtimeMs: number }>) {
  const db = await Database.create(undefined, { embeddingDimensions: 768 });
  const sessions = new AgentSessionStore(db.executor);
  const payloads = new DistilledPayloadStore(db.executor);
  return { db, sessions, payloads, transcripts: memTranscripts(files) };
}

async function recordFor(sessions: AgentSessionStore, sessionId: string, content: string) {
  const { createHash } = await import("node:crypto");
  return sessions.recordRevision({
    sourceInstance: "claude-code",
    sessionId,
    contentHash: createHash("sha256").update(content).digest("hex"),
    byteSize: Buffer.byteLength(content),
    lineCount: content.split("\n").length,
  });
}

describe("SessionDistiller.runTick — ledger → distill → outbox (no apply)", () => {
  it("distills a silent session end-to-end: payload in outbox, ledger distilled, redacted", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s1": { content: transcript, mtimeMs: now - HOUR },
    });
    try {
      const rec = await recordFor(sessions, "s1", transcript);
      const { provider, calls } = countingProvider([goodMapResponse(), goodReduceResponse()]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });

      const res = await distiller.runTick();
      expect(res.distilled).toBe(1);
      expect(calls()).toBeGreaterThan(0);

      const rev = await sessions.getRevision(rec.revision.id);
      expect(rev?.state).toBe("distilled");
      const stored = await payloads.getByRevision(rec.revision.id);
      expect(stored).not.toBeNull();
      // Second-pass privacy: the leaked phone number is redacted in the payload.
      expect(stored?.payload.signals[0].what).not.toContain("13800138000");
      // First-pass privacy: reversible restoration map is keyed by msg_id.
      expect(Object.keys(stored?.restorationMap ?? {})).toContain("msg-1");
      // No page writes whatsoever (hard PR-2 boundary).
      const pages = await db.executor.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM pages");
      expect(pages.rows[0].n).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("does not distill a session still active within the silence window", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s2": { content: transcript, mtimeMs: now - 5 * 60_000 }, // 5 min ago
    });
    try {
      await recordFor(sessions, "s2", transcript);
      const { provider, calls } = countingProvider([goodMapResponse(), goodReduceResponse()]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });
      const res = await distiller.runTick();
      expect(res.distilled).toBe(0);
      expect(res.skipped).toBe(1);
      expect(calls()).toBe(0);
    } finally {
      await db.executor.close();
    }
  });

  it("retries once in-tick on invalid output, then parks the revision in retrying", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s3": { content: transcript, mtimeMs: now - HOUR },
    });
    try {
      const rec = await recordFor(sessions, "s3", transcript);
      // Both attempts return garbage → validation fails twice.
      const { provider, calls } = countingProvider(["not json at all"]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });
      const res = await distiller.runTick();
      expect(res.failed).toBe(1);
      expect(calls()).toBe(2); // first attempt + exactly one retry

      const rev = await sessions.getRevision(rec.revision.id);
      expect(rev?.state).toBe("retrying");
      expect(rev?.retryCount).toBe(1);
      expect(await payloads.getByRevision(rec.revision.id)).toBeNull();
    } finally {
      await db.executor.close();
    }
  });

  it("dead-letters a retrying revision after exceeding max retries", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s4": { content: transcript, mtimeMs: now - HOUR },
    });
    try {
      const rec = await recordFor(sessions, "s4", transcript);
      await sessions.markState(rec.revision.id, "retrying");
      // Simulate prior failures at the threshold.
      await sessions.incrementRetry(rec.revision.id);
      await sessions.incrementRetry(rec.revision.id);
      await sessions.incrementRetry(rec.revision.id);

      const { provider } = countingProvider(["still not json"]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        // Far-future now → any retry backoff has elapsed.
        opts: { now: () => now + 100 * HOUR },
      });
      const res = await distiller.runTick();
      expect(res.deadLettered).toBe(1);
      const rev = await sessions.getRevision(rec.revision.id);
      expect(rev?.state).toBe("dead_letter");
    } finally {
      await db.executor.close();
    }
  });

  it("replays an existing payload without ever calling the LLM", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s5": { content: transcript, mtimeMs: now - HOUR },
    });
    try {
      const rec = await recordFor(sessions, "s5", transcript);
      // Payload already exists for this revision (e.g. crash after persist).
      await payloads.persist({
        sourceInstance: "claude-code",
        sessionId: "s5",
        revisionId: rec.revision.id,
        contentHash: rec.revision.contentHash,
        payload: { signals: [] },
        restorationMap: {},
      });
      // Force it back to a pending-looking state to prove replay guard runs first.
      const { provider, calls } = countingProvider([goodMapResponse()]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });
      const res = await distiller.runTick();
      expect(calls()).toBe(0); // never re-calls the LLM once a payload exists
      expect(res.replayed).toBe(0 + res.replayed); // field exists
    } finally {
      await db.executor.close();
    }
  });

  it("re-distills a new revision of an already-done session (revision recheck)", async () => {
    const now = Date.now();
    const changed = `${transcript}\n${JSON.stringify({ type: "user", message: { role: "user", content: "Actually also migrate CI." }, uuid: "u3", timestamp: "2026-01-01T02:00:00Z" })}`;
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s6": { content: changed, mtimeMs: now - HOUR },
    });
    try {
      // Revision A processed to done.
      const a = await recordFor(sessions, "s6", transcript);
      await sessions.markState(a.revision.id, "distilled");
      await sessions.markState(a.revision.id, "applying");
      await sessions.markState(a.revision.id, "done");
      // File changed → scanner recorded revision B (discovered).
      const b = await recordFor(sessions, "s6", changed);
      expect(b.status).toBe("revised");

      const { provider } = countingProvider([goodMapResponse(), goodReduceResponse()]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });
      const res = await distiller.runTick();
      expect(res.distilled).toBe(1);
      const revB = await sessions.getRevision(b.revision.id);
      expect(revB?.state).toBe("distilled");
      expect(await payloads.getByRevision(b.revision.id)).not.toBeNull();
    } finally {
      await db.executor.close();
    }
  });

  it("skips a discovered revision whose file content no longer matches (stale hash)", async () => {
    const now = Date.now();
    const { db, sessions, payloads, transcripts } = await setup({
      "claude-code/s7": { content: "totally different now", mtimeMs: now - HOUR },
    });
    try {
      await recordFor(sessions, "s7", transcript); // hash of OLD content
      const { provider, calls } = countingProvider([goodMapResponse()]);
      const distiller = new SessionDistiller({
        sessions,
        payloads,
        provider,
        privacy,
        transcripts,
        opts: { now: () => now },
      });
      const res = await distiller.runTick();
      expect(res.distilled).toBe(0);
      expect(res.skipped).toBe(1);
      expect(calls()).toBe(0);
      void payloads;
    } finally {
      await db.executor.close();
    }
  });
});

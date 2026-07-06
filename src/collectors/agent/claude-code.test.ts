import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClaudeCodeParser, createClaudeCodeCollector } from "./claude-code.js";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "memkin-cc-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function line(role: string, text: string, uuid: string, sessionId: string): string {
  return `${JSON.stringify({
    type: role,
    uuid,
    timestamp: "2026-07-07T00:00:00.000Z",
    sessionId,
    message: { role, content: text },
  })}\n`;
}

async function writeTranscript(sessionId: string): Promise<void> {
  const projDir = join(base, "proj");
  await mkdir(projDir, { recursive: true });
  await writeFile(
    join(projDir, `${sessionId}.jsonl`),
    line("user", "hi", `${sessionId}-u`, sessionId) +
      line("assistant", "yo", `${sessionId}-a`, sessionId),
    "utf-8",
  );
}

interface Collected {
  ids: Set<string>;
  count: number;
}

async function collect(
  collector: {
    fetch: (o: { cursor?: string }) => AsyncGenerator<{ metadata?: Record<string, unknown> }>;
  },
  cursor?: string,
): Promise<Collected> {
  const ids = new Set<string>();
  let count = 0;
  for await (const msg of collector.fetch({ cursor })) {
    count += 1;
    const sid = msg.metadata?.session_id as string | undefined;
    if (sid) ids.add(sid);
  }
  return { ids, count };
}

describe("createClaudeCodeCollector — cursor retirement", () => {
  it("yields ALL messages of a session that sorts before a stale cursor (no first-message drop)", async () => {
    // "aaa" < "zzz". The old `sessionId <= cursor` skip only dropped the FIRST message of
    // each such session (subsequent ones slipped through via seenSessions) — silently
    // losing the opening user turn, and dropping single-message sessions entirely.
    await writeTranscript("aaa"); // 2 messages: user + assistant
    const collector = createClaudeCodeCollector(base);

    const { ids, count } = await collect(collector, "zzz");
    expect(ids.has("aaa")).toBe(true);
    expect(count).toBe(2); // both turns, not just the assistant reply
  });

  it("does not drop a single-message session that sorts before the cursor", async () => {
    const projDir = join(base, "proj");
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, "aaa.jsonl"), line("user", "solo", "aaa-u", "aaa"), "utf-8");
    const collector = createClaudeCodeCollector(base);

    const { ids } = await collect(collector, "zzz");
    expect(ids.has("aaa")).toBe(true);
  });

  it("yields all sessions regardless of cursor value", async () => {
    await writeTranscript("aaa");
    await writeTranscript("mmm");
    const collector = createClaudeCodeCollector(base);

    const { ids } = await collect(collector, "nnn");
    expect(ids.has("aaa")).toBe(true);
    expect(ids.has("mmm")).toBe(true);
  });

  it("no longer emits a cursor in message metadata (disables legacy pipeline cursor write)", () => {
    const parser = new ClaudeCodeParser();
    const msg = parser.parseRecord(
      {
        type: "user",
        uuid: "u1",
        timestamp: "2026-07-07T00:00:00.000Z",
        sessionId: "sess-1",
        message: { role: "user", content: "hi" },
      },
      {
        sessionId: "sess-1",
        filePath: "/x.jsonl",
        channel: "sess-1",
        lineIndex: 0,
        sessionMeta: null,
      },
    );
    expect(msg).not.toBeNull();
    expect(msg?.metadata).toBeDefined();
    expect(msg?.metadata?.cursor).toBeUndefined();
    expect(msg?.metadata?.session_id).toBe("sess-1");
  });
});

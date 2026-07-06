import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readStableSnapshot, type SnapshotFs } from "./collector.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "memkin-snap-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readStableSnapshot", () => {
  it("returns content + hash + byteSize + lineCount for a stable file", async () => {
    const file = join(dir, "s.jsonl");
    const content = '{"a":1}\n{"b":2}\n{"c":3}\n';
    await writeFile(file, content, "utf-8");

    const snap = await readStableSnapshot(file);
    expect(snap).not.toBeNull();
    if (!snap) return;
    expect(snap.content).toBe(content);
    expect(snap.contentHash).toBe(createHash("sha256").update(content).digest("hex"));
    expect(snap.byteSize).toBe(Buffer.byteLength(content, "utf-8"));
    // lineCount = total lines via split("\n")
    expect(snap.lineCount).toBe(content.split("\n").length);
  });

  it("returns null when the file size changes between the two stats (write-in-progress)", async () => {
    const file = join(dir, "s.jsonl");
    await writeFile(file, '{"a":1}\n', "utf-8");

    let call = 0;
    const deps: SnapshotFs = {
      stat: async (p) => {
        const s = await stat(p);
        call += 1;
        // Second stat reports a larger size, as if an append raced the read.
        return { size: call === 2 ? s.size + 91 : s.size, mtimeMs: s.mtimeMs };
      },
      readFile: (p, enc) => readFile(p, enc),
    };

    const snap = await readStableSnapshot(file, deps);
    expect(snap).toBeNull();
  });

  it("returns null when the mtime changes between the two stats", async () => {
    const file = join(dir, "s.jsonl");
    await writeFile(file, '{"a":1}\n', "utf-8");

    let call = 0;
    const deps: SnapshotFs = {
      stat: async (p) => {
        const s = await stat(p);
        call += 1;
        return { size: s.size, mtimeMs: call === 2 ? s.mtimeMs + 1000 : s.mtimeMs };
      },
      readFile: (p, enc) => readFile(p, enc),
    };

    const snap = await readStableSnapshot(file, deps);
    expect(snap).toBeNull();
  });

  it("returns null for a missing file", async () => {
    const snap = await readStableSnapshot(join(dir, "nope.jsonl"));
    expect(snap).toBeNull();
  });
});

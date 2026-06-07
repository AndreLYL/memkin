import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest, type SyncManifest, saveManifest } from "../../src/sync/obsidian.js";

describe("Manifest I/O (T3)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "manifest-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loadManifest returns null when file does not exist", async () => {
    const result = await loadManifest(dir);
    expect(result).toBeNull();
  });

  it("saveManifest writes JSON readable by loadManifest", async () => {
    const manifest: SyncManifest = {
      version: 2,
      last_sync_at: "2026-06-04T10:00:00Z",
      last_sync_op: "export",
      pages: {
        "person/alice": {
          file_hash: "abc",
          db_content_hash_at_last_sync: "def",
          last_synced_at: "2026-06-04T10:00:00Z",
          last_synced_op: "export",
          user_edited: false,
        },
      },
    };
    await saveManifest(dir, manifest);
    const loaded = await loadManifest(dir);
    expect(loaded).toEqual(manifest);
  });

  it("L2: uses last_sync_at / last_synced_op field names", async () => {
    const manifest: SyncManifest = {
      version: 2,
      last_sync_at: "2026-06-04T10:00:00Z",
      last_sync_op: "import",
      pages: {},
    };
    await saveManifest(dir, manifest);
    const raw = await readFile(join(dir, ".memoark-sync.json"), "utf-8");
    expect(raw).toContain("last_sync_at");
    expect(raw).toContain("last_sync_op");
    expect(raw).not.toContain("exported_at");
  });

  it("M8: atomic write — tmp file is cleaned up on success", async () => {
    const manifest: SyncManifest = {
      version: 2,
      last_sync_at: "2026-06-04T10:00:00Z",
      last_sync_op: "export",
      pages: {},
    };
    await saveManifest(dir, manifest);
    const tmpPath = join(dir, ".memoark-sync.json.tmp");
    let tmpExists = false;
    try {
      await readFile(tmpPath);
      tmpExists = true;
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);
  });

  it("loadManifest returns null for malformed JSON (defensive)", async () => {
    await writeFile(join(dir, ".memoark-sync.json"), "{not json", "utf-8");
    const result = await loadManifest(dir);
    expect(result).toBeNull();
  });

  it("loadManifest returns null for wrong version (defensive)", async () => {
    await writeFile(
      join(dir, ".memoark-sync.json"),
      JSON.stringify({ version: 999, pages: {} }),
      "utf-8",
    );
    const result = await loadManifest(dir);
    expect(result).toBeNull();
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CursorStore } from "../../src/core/cursors";

describe("Pipeline CursorProvider integration", () => {
  let dir: string;
  let store: CursorStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cursor-test-"));
    store = new CursorStore(join(dir, "cursors.yaml"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("setJSON round-trips structured cursor through CursorStore", () => {
    const checkpoint = {
      messages: { oc_chat_001: { last_sync_at: 1716300000000 } },
      calendar: { cal_primary: { sync_token: "sync_v2" } },
    };

    store.setJSON("feishu", checkpoint);
    store.commit();

    const store2 = new CursorStore(join(dir, "cursors.yaml"));
    store2.load();
    const recovered = store2.getJSON<typeof checkpoint>("feishu");
    expect(recovered).toEqual(checkpoint);
  });

  it("getJSON returns undefined for missing key", () => {
    store.load();
    expect(store.getJSON("nonexistent")).toBeUndefined();
  });

  it("getJSON returns undefined for non-JSON string cursor", () => {
    store.set("legacy", "simple-cursor-string");
    expect(store.getJSON("legacy")).toBeUndefined();
  });

  it("duck-typed CursorProvider detection works", () => {
    const provider = {
      getCommittableCursors: () => ({ messages: {} }),
      discardSource: () => {},
    };
    const isCursorProvider = (s: unknown): boolean =>
      typeof s === "object" && s !== null && "getCommittableCursors" in s;

    expect(isCursorProvider(provider)).toBe(true);
    expect(isCursorProvider({})).toBe(false);
    expect(isCursorProvider(null)).toBe(false);
  });
});

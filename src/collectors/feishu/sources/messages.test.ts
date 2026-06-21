import { describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../cursor-staging.js";
import { MessageSource } from "./messages.js";

/**
 * Minimal cursorStaging stub — we only care about which chats are queried,
 * not the commit/stage behaviour.
 */
function makeStaging(): CursorStaging {
  return new CursorStaging();
}

/**
 * Build a mock paginate function whose behavior depends on the path:
 *
 *   /open-apis/im/v1/chats    → yields one page with the chat_ids from `chatListFactory()`
 *   /open-apis/im/v1/messages → yields one empty page; records the container_id in `queriedChats`
 *
 * `chatListFactory` is called fresh on each `paginate("/chats", …)` call so tests
 * can change it to simulate a newly-joined group appearing in the second fetch.
 */
function makeMockClient(chatListFactory: () => Array<{ chat_id: string }>, queriedChats: string[]) {
  const paginate = vi.fn(async function* (path: string, params?: Record<string, string>) {
    if (path === "/open-apis/im/v1/chats") {
      yield { items: chatListFactory(), has_more: false };
      return;
    }

    if (path === "/open-apis/im/v1/messages") {
      const chatId = params?.container_id ?? "";
      queriedChats.push(chatId);
      yield { items: [], has_more: false };
      return;
    }

    throw new Error(`unexpected paginate path: ${path}`);
  });

  return { paginate } as never;
}

// ---------------------------------------------------------------------------
// Test 1: autoIncludeAllGroups=true, chatIds=[] → queries oc_a and oc_b
// ---------------------------------------------------------------------------
describe("MessageSource — autoIncludeAllGroups", () => {
  it("fetches from all live groups when autoIncludeAllGroups=true and chatIds is empty", async () => {
    const queriedChats: string[] = [];
    const client = makeMockClient(() => [{ chat_id: "oc_a" }, { chat_id: "oc_b" }], queriedChats);

    const src = new MessageSource(client, [], {
      lookbackDays: 1,
      autoIncludeAllGroups: true,
    });

    for await (const _ of src.fetch(null, makeStaging())) {
      /* drain */
    }

    expect(queriedChats).toContain("oc_a");
    expect(queriedChats).toContain("oc_b");
    expect(queriedChats).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Test 2: newly-joined group oc_c is picked up on a fresh fetch
  // ---------------------------------------------------------------------------
  it("picks up a newly-joined group on the next fetch when autoIncludeAllGroups=true", async () => {
    let includeOcC = false;
    const queriedChats: string[] = [];

    const client = makeMockClient(
      () => [
        { chat_id: "oc_a" },
        { chat_id: "oc_b" },
        ...(includeOcC ? [{ chat_id: "oc_c" }] : []),
      ],
      queriedChats,
    );

    const src = new MessageSource(client, [], {
      lookbackDays: 1,
      autoIncludeAllGroups: true,
    });

    // First fetch — only oc_a, oc_b
    for await (const _ of src.fetch(null, makeStaging())) {
      /* drain */
    }
    expect(queriedChats).toEqual(expect.arrayContaining(["oc_a", "oc_b"]));
    expect(queriedChats).not.toContain("oc_c");

    // Simulate joining a new group
    includeOcC = true;
    queriedChats.length = 0;

    // Second fetch — oc_c should now be included
    for await (const _ of src.fetch(null, makeStaging())) {
      /* drain */
    }
    expect(queriedChats).toContain("oc_c");
  });

  // ---------------------------------------------------------------------------
  // Test 3: autoIncludeAllGroups=false, chatIds=[] → still throws
  // ---------------------------------------------------------------------------
  it("throws the existing empty-chat_ids error when autoIncludeAllGroups=false and chatIds is empty", async () => {
    const queriedChats: string[] = [];
    const client = makeMockClient(() => [{ chat_id: "oc_a" }], queriedChats);

    const src = new MessageSource(client, [], {
      lookbackDays: 1,
      autoIncludeAllGroups: false,
    });

    await expect(async () => {
      for await (const _ of src.fetch(null, makeStaging())) {
        /* drain */
      }
    }).rejects.toThrow("messages source enabled but chat_ids is empty");
  });

  // ---------------------------------------------------------------------------
  // Test 4: autoIncludeAllGroups=true, chatIds=["oc_x"] → union (deduped)
  // ---------------------------------------------------------------------------
  it("queries the union of configured and live chat IDs (deduped) when autoIncludeAllGroups=true", async () => {
    const queriedChats: string[] = [];
    // oc_a is returned by the live API; oc_x is the configured one
    // oc_a is also added to the live list to test dedup (if oc_x overlapped)
    const client = makeMockClient(() => [{ chat_id: "oc_a" }, { chat_id: "oc_b" }], queriedChats);

    const src = new MessageSource(client, ["oc_x"], {
      lookbackDays: 1,
      autoIncludeAllGroups: true,
    });

    for await (const _ of src.fetch(null, makeStaging())) {
      /* drain */
    }

    expect(queriedChats).toContain("oc_x");
    expect(queriedChats).toContain("oc_a");
    expect(queriedChats).toContain("oc_b");
    // Must be deduped — each ID appears exactly once
    const unique = new Set(queriedChats);
    expect(queriedChats).toHaveLength(unique.size);
  });

  // ---------------------------------------------------------------------------
  // Test 5: dedup when a configured chatId also appears in the live list
  // ---------------------------------------------------------------------------
  it("dedups when a configured chatId also appears in the live list", async () => {
    const queriedChats: string[] = [];
    // chatIds = ["oc_a"], live returns ["oc_a", "oc_b"]
    // → messages queried for oc_a exactly once, plus oc_b
    const client = makeMockClient(() => [{ chat_id: "oc_a" }, { chat_id: "oc_b" }], queriedChats);

    const src = new MessageSource(client, ["oc_a"], {
      lookbackDays: 1,
      autoIncludeAllGroups: true,
    });

    for await (const _ of src.fetch(null, makeStaging())) {
      /* drain */
    }

    // oc_a should appear exactly once, even though it's in both configured and live
    const ocACount = queriedChats.filter((id) => id === "oc_a").length;
    expect(ocACount).toBe(1);
    expect(queriedChats).toContain("oc_b");
    expect(queriedChats).toHaveLength(2);
  });
});

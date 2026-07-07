import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "./database.js";
import { EntityMergeSuggestionStore } from "./entity-suggestions.js";

describe("EntityMergeSuggestionStore", () => {
  let db: Database;
  let store: EntityMergeSuggestionStore;

  beforeEach(async () => {
    db = await Database.create(undefined, { embeddingDimensions: 768 });
    store = new EntityMergeSuggestionStore(db.executor);
  });

  afterEach(async () => {
    await db.close();
  });

  it("records a suggestion as pending and lists it", async () => {
    await store.record({
      entity_type: "tool",
      from_slug: "tool/lark-cli-http-client",
      into_slug: "tool/larkclihttpclient",
      reason: "same_name",
      detail: { name: "LarkCliHttpClient" },
    });
    const pending = await store.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");
    expect(pending[0].reason).toBe("same_name");
    expect(pending[0].detail).toEqual({ name: "LarkCliHttpClient" });
  });

  it("re-recording the same suggestion is idempotent", async () => {
    const candidate = {
      entity_type: "project" as const,
      from_slug: "project/a",
      into_slug: "project/b",
      reason: "levenshtein" as const,
    };
    await store.record(candidate);
    await store.record(candidate);
    expect(await store.listPending()).toHaveLength(1);
  });

  it("does NOT resurrect a dismissed suggestion on re-record", async () => {
    await store.record({
      entity_type: "tool",
      from_slug: "tool/a",
      into_slug: "tool/b",
      reason: "same_name",
    });
    const [s] = await store.listPending();
    await store.resolve(s.id, "dismissed");
    expect(await store.listPending()).toHaveLength(0);

    // The consolidator sweep will keep re-detecting the same pair; a dismissal
    // must stick.
    await store.record({
      entity_type: "tool",
      from_slug: "tool/a",
      into_slug: "tool/b",
      reason: "same_name",
    });
    expect(await store.listPending()).toHaveLength(0);
  });

  it("resolve marks accepted with resolved_at; merge execution stays explicit", async () => {
    await store.record({
      entity_type: "person",
      from_slug: "person/wang-jian-du",
      into_slug: "person/wang-jiandu",
      reason: "pinyin",
    });
    const [s] = await store.listPending();
    await store.resolve(s.id, "accepted");
    const row = await store.get(s.id);
    expect(row?.status).toBe("accepted");
    expect(row?.resolved_at).toBeTruthy();
  });

  it("listPending filters by entity type", async () => {
    await store.record({
      entity_type: "tool",
      from_slug: "tool/a",
      into_slug: "tool/b",
      reason: "same_name",
    });
    await store.record({
      entity_type: "project",
      from_slug: "project/a",
      into_slug: "project/b",
      reason: "same_name",
    });
    const tools = await store.listPending({ entityType: "tool" });
    expect(tools).toHaveLength(1);
    expect(tools[0].entity_type).toBe("tool");
  });
});

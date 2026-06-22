import { createHash } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { loadExistingCard, writeCard } from "../../../../src/collectors/feishu/docs/store-writer";
import type { FullCard, PointerCard } from "../../../../src/collectors/feishu/docs/types";

const pointer: PointerCard = {
  doc_token: "tok9",
  doc_type: "docx",
  title: "T",
  url: "u",
  owner_id: "o",
  last_editor_id: "e",
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-02-01T00:00:00Z",
  source: { kind: "my_space", folder_token: "f" },
  parent_path: "My Space/",
  extract_level: "pointer",
  extracted_at: "2026-06-14T00:00:00Z",
};

describe("writeCard", () => {
  test("writes under feishu-docs/<token> with halflife null and rechunks", async () => {
    const putPage = vi.fn(async () => ({ id: 42, compiled_truth: "BODY" }));
    const rechunk = vi.fn(async () => {});
    const stores = { pages: { putPage }, chunks: { rechunk } };
    await writeCard(stores as never, pointer);
    expect(putPage).toHaveBeenCalledTimes(1);
    const [slug, content, opts] = putPage.mock.calls[0];
    expect(slug).toBe("feishu-docs/tok9");
    expect(content.startsWith("---\n")).toBe(true);
    expect(opts).toEqual({ halflife_days: null });
    expect(rechunk).toHaveBeenCalledWith(42, "BODY");
  });
});

const hash8 = (text: string): string =>
  createHash("sha256").update(text).digest("hex").slice(0, 8);

function fullCardWithActionItems(): FullCard {
  return {
    doc_token: "DOC1",
    doc_type: "docx",
    title: "Sprint Review",
    url: "u",
    owner_id: "o",
    last_editor_id: "e",
    created_at: "2026-01-01T00:00:00Z",
    modified_at: "2026-02-01T00:00:00Z",
    source: { kind: "my_space", folder_token: "f" },
    parent_path: "My Space/",
    extract_level: "full",
    purpose: "Sprint review",
    topics: ["sprint"],
    entities: [],
    toc: [],
    overview: "Notes.",
    decisions: [],
    action_items: [
      { text: "Write migration guide", owner_raw: "Bob", due: "2026-02-10", status: "open" },
      { text: "Schedule retro", status: "open" },
    ],
    source_body_hash: "deadbeef",
    summary_generated_at: "2026-06-14T00:00:00Z",
    summary_model: "mock",
    extracted_at: "2026-06-14T00:00:00Z",
  };
}

describe("writeCard action_items → task signals", () => {
  function makeStores() {
    const pages = {
      putPage: vi.fn(async (slug: string, _content: string) => ({
        id: slug === "feishu-docs/DOC1" ? 1 : 2,
        compiled_truth: "BODY",
      })),
    };
    const chunks = { rechunk: vi.fn(async () => {}) };
    const graph = { addLink: vi.fn(async () => {}) };
    return { pages, chunks, graph };
  }

  test("persists each action_item as a task page with hash slug + anchors owner", async () => {
    const stores = makeStores();
    const card = fullCardWithActionItems();
    await writeCard(stores as never, card, {
      graph: stores.graph as never,
      resolveOwner: async (raw?: string) => (raw === "Bob" ? "people/bob" : null),
      isMe: async () => false,
    });

    const taskCalls = stores.pages.putPage.mock.calls.filter(([slug]) =>
      String(slug).startsWith("tasks/"),
    );
    expect(taskCalls.length).toBe(2);

    const slug0 = `tasks/doc-DOC1-${hash8("Write migration guide")}`;
    expect(taskCalls.some(([slug]) => slug === slug0)).toBe(true);

    const [, content0] = taskCalls.find(([slug]) => slug === slug0)!;
    expect(content0).toContain("type: task");
    expect(content0).toContain("owner_slug: people/bob");
    expect(content0).toContain("2026-02-10");
    expect(content0).toContain("status: open");
    expect(content0).toContain("source: doc:DOC1");

    // anchor link from task to owner
    expect(stores.graph.addLink).toHaveBeenCalledWith(slug0, "people/bob", "mentions");
  });

  test("anchors to entities/me when the owner is me", async () => {
    const stores = makeStores();
    const card = fullCardWithActionItems();
    await writeCard(stores as never, card, {
      graph: stores.graph as never,
      resolveOwner: async () => "entities/me",
      isMe: async (slug: string) => slug === "entities/me",
    });
    const slug = `tasks/doc-DOC1-${hash8("Write migration guide")}`;
    expect(stores.graph.addLink).toHaveBeenCalledWith(slug, "entities/me", "mentions");
  });

  test("task slug is content-hashed (idempotent across re-extraction order)", async () => {
    const stores = makeStores();
    const card = fullCardWithActionItems();
    await writeCard(stores as never, card, {
      graph: stores.graph as never,
      resolveOwner: async () => null,
      isMe: async () => false,
    });
    const expected = `tasks/doc-DOC1-${hash8("Schedule retro")}`;
    expect(stores.pages.putPage.mock.calls.some(([slug]) => slug === expected)).toBe(true);
  });

  test("no action_items + no opts behaves like before (only the card page)", async () => {
    const stores = makeStores();
    const card = fullCardWithActionItems();
    card.action_items = [];
    await writeCard(stores as never, card);
    expect(stores.pages.putPage).toHaveBeenCalledTimes(1);
  });
});

describe("loadExistingCard", () => {
  test("returns null when page absent", async () => {
    const stores = { pages: { getPage: async () => null } };
    expect(await loadExistingCard(stores as never, "tokX")).toBe(null);
  });

  test("reconstructs a full card from frontmatter", async () => {
    const stores = {
      pages: {
        getPage: async () => ({
          frontmatter: {
            extract_level: "full",
            doc_token: "tok9",
            modified_at: "2026-02-01T00:00:00Z",
            source_body_hash: "deadbeef",
          },
        }),
      },
    };
    const card = await loadExistingCard(stores as never, "tok9");
    expect(card?.extract_level).toBe("full");
    if (card?.extract_level === "full") expect(card.source_body_hash).toBe("deadbeef");
  });
});

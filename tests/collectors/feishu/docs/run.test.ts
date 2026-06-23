import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { normalizeDocsConfig } from "../../../../src/collectors/feishu/docs/config";
import { computeSourceBodyHash } from "../../../../src/collectors/feishu/docs/hash";
import { runDocSource } from "../../../../src/collectors/feishu/docs/run";
import { createMockProvider } from "../../../../src/extractors/providers/mock";

const hash8 = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 8);

// CALIBRATED 2026-06-14: the drive/v1/files list API returns no edit_users, so
// last_editor_id falls back to owner_id. For My Space, T1 self_edit therefore
// means self-OWNED — the `owner` arg drives the trigger.
const file = (token: string, owner: string) => ({
  token,
  name: token,
  type: "docx",
  url: `u/${token}`,
  owner_id: owner,
  created_time: "1700000000",
  modified_time: "1717200000",
});

function fakeClient(rootFiles: unknown[], blocksRaw: string) {
  return {
    async request(_m: string, path: string) {
      if (path.endsWith("/root_folder/meta")) return { code: 0, data: { token: "root" } };
      throw new Error(`unexpected ${path}`);
    },
    async *paginate(path: string, params?: Record<string, string>) {
      if (path.includes("/blocks")) {
        yield {
          items: [{ block_type: 2, text: { elements: [{ text_run: { content: blocksRaw } }] } }],
          has_more: false,
        };
      } else if (params?.folder_token === "root") {
        yield { items: rootFiles, has_more: false };
      } else {
        yield { items: [], has_more: false };
      }
    },
    async execShortcut() {
      return "";
    },
  };
}

function fakeStores() {
  const written: Record<string, string> = {};
  return {
    written,
    pages: {
      async getPage() {
        return null;
      },
      async putPage(slug: string, content: string) {
        written[slug] = content;
        return { id: 1, compiled_truth: "B" };
      },
    },
    chunks: { async rechunk() {} },
  };
}

const llmJson = JSON.stringify({
  purpose: "P",
  topics: ["t"],
  entities: [],
  overview: "o".repeat(220),
});

describe("runDocSource", () => {
  test("self-edited doc → full card; other doc → pointer card", async () => {
    const client = fakeClient([file("mine", "ou_me"), file("theirs", "ou_other")], "x".repeat(500));
    const stores = fakeStores();
    const provider = createMockProvider(new Map([["", llmJson]]));
    const cfg = normalizeDocsConfig({
      enabled: true,
      wiki: { enabled: false },
      self_open_id: "ou_me",
    });

    const cursor = {
      _data: {} as Record<string, unknown>,
      getJSON(id: string) {
        return this._data[id];
      },
      setJSON(id: string, d: unknown) {
        this._data[id] = d;
      },
      commit() {},
    };

    const stats = await runDocSource({
      client: client as never,
      stores: stores as never,
      provider,
      config: cfg,
      cursor: cursor as never,
      selfOpenId: "ou_me",
      nowMs: Date.parse("2026-06-14T00:00:00Z"),
      nowIso: () => "2026-06-14T00:00:00Z",
    });

    expect(stats.pointer_saved).toBe(1);
    expect(stats.full_card_generated).toBe(1);
    expect(Object.keys(stores.written).sort()).toEqual(["feishu-docs/mine", "feishu-docs/theirs"]);
    expect(stores.written["feishu-docs/mine"]).toContain("extract_level: full");
    expect(stores.written["feishu-docs/theirs"]).toContain("extract_level: pointer");
  });

  test("existing full card + body unchanged → metadata_refresh keeps the summary", async () => {
    const token = "doc1";
    const rawBody = "x".repeat(500);
    const existingFullCard = {
      doc_token: token,
      doc_type: "docx",
      title: "old title",
      url: `u/${token}`,
      owner_id: "ou_owner",
      last_editor_id: "ou_me",
      created_at: "2023-01-01T00:00:00.000Z",
      // OLDER than the candidate's modified_at (derived from modified_time 1717200000)
      modified_at: "2024-01-01T00:00:00.000Z",
      source: { kind: "my_space", folder_token: "root" },
      parent_path: "",
      extract_level: "full",
      purpose: "OLD PURPOSE",
      topics: ["old-topic"],
      entities: [],
      toc: [],
      overview: "old overview",
      // same body → metadata_refresh (not re-summarize)
      source_body_hash: computeSourceBodyHash(rawBody),
      summary_generated_at: "2024-01-01T00:00:00.000Z",
      summary_model: "old-model",
      extracted_at: "2024-01-01T00:00:00.000Z",
    };

    const client = fakeClient([file(token, "ou_me")], rawBody);
    const stores = fakeStores();
    // Return the existing full card frontmatter for this slug.
    stores.pages.getPage = async (slug: string) =>
      slug === `feishu-docs/${token}` ? { frontmatter: existingFullCard } : null;

    let providerCalled = false;
    const baseProvider = createMockProvider(new Map([["", llmJson]]));
    const provider: typeof baseProvider = {
      async chat(messages, opts) {
        providerCalled = true;
        return baseProvider.chat(messages, opts);
      },
    };

    const cfg = normalizeDocsConfig({
      enabled: true,
      wiki: { enabled: false },
      self_open_id: "ou_me",
    });

    const cursor = {
      _data: {} as Record<string, unknown>,
      getJSON(id: string) {
        return this._data[id];
      },
      setJSON(id: string, d: unknown) {
        this._data[id] = d;
      },
      commit() {},
    };

    const stats = await runDocSource({
      client: client as never,
      stores: stores as never,
      provider: provider as never,
      config: cfg,
      cursor: cursor as never,
      selfOpenId: "ou_me",
      nowMs: Date.parse("2026-06-14T00:00:00Z"),
      nowIso: () => "2026-06-14T00:00:00Z",
    });

    const written = stores.written[`feishu-docs/${token}`];
    expect(written).toContain("extract_level: full");
    expect(written).toContain("OLD PURPOSE");
    expect(stats.full_card_refreshed).toBe(1);
    expect(providerCalled).toBe(false);
  });

  test("forwards actionItemDeps so full-card action_items become task signals", async () => {
    const client = fakeClient([file("mine", "ou_me")], "x".repeat(500));
    const stores = fakeStores();
    const graphLinks: Array<[string, string, string]> = [];
    const actionItemDeps = {
      graph: {
        async addLink(from: string, to: string, kind: string) {
          graphLinks.push([from, to, kind]);
        },
      } as never,
      resolveOwner: async (raw: string | undefined) => (raw === "Bob" ? "people/bob" : null),
      isMe: async () => false,
    };

    const llmWithActions = JSON.stringify({
      purpose: "P",
      topics: ["t"],
      entities: [],
      overview: "o".repeat(220),
      action_items: [
        { text: "Write migration guide", owner: "Bob", due: "2026-02-10" },
        { text: "Schedule retro", owner: null, due: null },
      ],
    });
    const provider = createMockProvider(new Map([["", llmWithActions]]));
    const cfg = normalizeDocsConfig({
      enabled: true,
      wiki: { enabled: false },
      self_open_id: "ou_me",
    });
    const cursor = {
      _data: {} as Record<string, unknown>,
      getJSON(id: string) {
        return this._data[id];
      },
      setJSON(id: string, d: unknown) {
        this._data[id] = d;
      },
      commit() {},
    };

    await runDocSource({
      client: client as never,
      stores: stores as never,
      provider,
      config: cfg,
      cursor: cursor as never,
      selfOpenId: "ou_me",
      nowMs: Date.parse("2026-06-14T00:00:00Z"),
      nowIso: () => "2026-06-14T00:00:00Z",
      actionItemDeps,
    });

    const taskSlug0 = `tasks/doc-mine-${hash8("Write migration guide")}`;
    const taskSlug1 = `tasks/doc-mine-${hash8("Schedule retro")}`;
    expect(stores.written[taskSlug0]).toContain("type: task");
    expect(stores.written[taskSlug0]).toContain("owner_slug: people/bob");
    expect(stores.written[taskSlug1]).toContain("type: task");
    expect(graphLinks).toContainEqual([taskSlug0, "people/bob", "mentions"]);
  });
});

import { describe, expect, test } from "vitest";
import { ingestFeishuDoc } from "../../../../src/collectors/feishu/docs/ingest";
import { createMockProvider } from "../../../../src/extractors/providers/mock";

const llmJson = JSON.stringify({ purpose: "LLM purpose", topics: ["t"], entities: [], overview: "o".repeat(220) });

function deps(overrides: Record<string, unknown> = {}) {
  const written: Record<string, string> = {};
  const client = {
    async request(_m: string, path: string) {
      if (path.includes("/metas") || path.includes("/files/")) {
        return { code: 0, data: { metas: [{ doc_token: "tok", title: "Real Title", url: "https://feishu.cn/docx/tok", owner_id: "ou_owner", latest_modify_time: "1717200000", create_time: "1700000000" }] } };
      }
      if (path.includes("get_node")) {
        return { code: 0, data: { node: { obj_token: "tok", obj_type: "docx" } } };
      }
      throw new Error("unexpected " + path);
    },
    async *paginate(path: string) {
      if (path.includes("/blocks")) yield { items: [{ block_type: 2, text: { elements: [{ text_run: { content: "x".repeat(500) } }] } }], has_more: false };
      else yield { items: [], has_more: false };
    },
    async execShortcut() {
      return "";
    },
  };
  const stores = {
    written,
    pages: { async getPage() { return null; }, async putPage(slug: string, content: string) { written[slug] = content; return { id: 1, compiled_truth: "B" }; } },
    chunks: { async rechunk() {} },
  };
  return {
    written,
    deps: {
      client,
      stores,
      provider: createMockProvider(new Map([["", llmJson]])),
      model: "mock-model",
      nowIso: () => "2026-06-14T00:00:00Z",
      ...overrides,
    },
  };
}

describe("ingestFeishuDoc", () => {
  test("rejects unsupported doc type", async () => {
    const { deps: d } = deps();
    const out = await ingestFeishuDoc(d as never, { url_or_token: "https://feishu.cn/sheets/shtcn123456789012345" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("UNSUPPORTED_DOC_TYPE");
  });

  test("rejects invalid url", async () => {
    const { deps: d } = deps();
    const out = await ingestFeishuDoc(d as never, { url_or_token: "garbage" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe("INVALID_URL");
  });

  test("ingests a docx token and forces purpose from note", async () => {
    const { deps: d, written } = deps();
    const out = await ingestFeishuDoc(d as never, { url_or_token: "Abngd03Swoll47xr347c8rhrndg", note: "the real purpose" });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.extract_level).toBe("full");
      expect(out.card.purpose).toBe("the real purpose"); // forced over LLM
    }
    expect(written["feishu-docs/Abngd03Swoll47xr347c8rhrndg"]).toContain("extract_level: full");
  });

  test("resolves a wiki node URL to its docx obj_token", async () => {
    const { deps: d } = deps();
    const out = await ingestFeishuDoc(d as never, { url_or_token: "https://feishu.cn/wiki/Node1234567890abcdef" });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.doc_token).toBe("tok");
  });
});

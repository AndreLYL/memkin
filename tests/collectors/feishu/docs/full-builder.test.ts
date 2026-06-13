import { describe, expect, test } from "vitest";
import { FullCardBuilder } from "../../../../src/collectors/feishu/docs/full-builder";
import type { DocCandidate } from "../../../../src/collectors/feishu/docs/types";
import { createMockProvider } from "../../../../src/extractors/providers/mock";

const cand: DocCandidate = {
  doc_token: "t",
  doc_type: "docx",
  title: "T",
  url: "u",
  owner_id: "o",
  last_editor_id: "e",
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-02-01T00:00:00Z",
  source: { kind: "my_space", folder_token: "f" },
  parent_path: "My Space/",
};

const goodLlmJson = JSON.stringify({
  purpose: "Track roadmap",
  topics: ["roadmap"],
  entities: [{ name: "Memoark", type_guess: "project" }],
  overview: "An overview.",
});

function clientWithBlocks(blocks: unknown[], rawLen = 500) {
  // pad text so it passes the 200-char gate
  const pad = "x".repeat(rawLen);
  const allBlocks = [
    { block_type: 2, text: { elements: [{ text_run: { content: pad } }] } },
    ...blocks,
  ];
  return {
    async *paginate(path: string) {
      if (path.includes("/blocks")) yield { items: allBlocks, has_more: false };
      else yield { items: [], has_more: false };
    },
    async request() {
      throw new Error("not used");
    },
    async execShortcut() {
      return "";
    },
  };
}

describe("FullCardBuilder", () => {
  test("builds a full card from blocks + LLM", async () => {
    const provider = createMockProvider(new Map([["", goodLlmJson]]));
    const builder = new FullCardBuilder(
      clientWithBlocks([
        { block_type: 3, heading1: { elements: [{ text_run: { content: "Goals" } }] } },
      ]) as never,
      provider,
      "mock-model",
      () => "2026-06-14T00:00:00Z",
    );
    const result = await builder.build(cand);
    expect(result.extract_level).toBe("full");
    if (result.extract_level === "full") {
      expect(result.purpose).toBe("Track roadmap");
      expect(result.toc).toEqual([{ level: 1, title: "Goals" }]);
      expect(result.source_body_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.summary_model).toBe("mock-model");
    }
  });

  test("degrades to pointer with extract_skipped when below min chars", async () => {
    const provider = createMockProvider(new Map([["", goodLlmJson]]));
    const builder = new FullCardBuilder(
      clientWithBlocks([], 10) as never,
      provider,
      "mock-model",
      () => "2026-06-14T00:00:00Z",
    );
    const result = await builder.build(cand);
    expect(result.extract_level).toBe("pointer");
    if (result.extract_level === "pointer") expect(result.extract_skipped).toBe("below_min_chars");
  });

  test("degrades to pointer with extract_error on unparseable LLM output", async () => {
    const provider = createMockProvider(new Map([["", "not json"]]));
    const builder = new FullCardBuilder(
      clientWithBlocks([]) as never,
      provider,
      "mock-model",
      () => "2026-06-14T00:00:00Z",
    );
    const result = await builder.build(cand);
    expect(result.extract_level).toBe("pointer");
    if (result.extract_level === "pointer") expect(result.extract_error).toBe("llm_invalid_json");
  });
});

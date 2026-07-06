import { describe, expect, test } from "vitest";
import { FullCardBuilder } from "../../../../src/collectors/feishu/docs/full-builder";
import type { DocCandidate } from "../../../../src/collectors/feishu/docs/types";
import { createMockProvider } from "../../../../src/extractors/providers/mock";

const cand: DocCandidate = {
  doc_token: "t",
  doc_type: "docx",
  title: "Meeting Notes",
  url: "u",
  owner_id: "o",
  last_editor_id: "e",
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-02-01T00:00:00Z",
  source: { kind: "my_space", folder_token: "f" },
  parent_path: "My Space/",
};

const llmJson = JSON.stringify({
  purpose: "Sprint review",
  topics: ["sprint", "roadmap"],
  entities: [{ name: "Memkin", type_guess: "project" }],
  overview: "Notes from the sprint review meeting.",
  decisions: [{ text: "Ship v2 next week", made_by: "Alice" }],
  action_items: [
    { text: "Write the migration guide", owner: "Bob", due: "2026-02-10" },
    { text: "Schedule retro", owner: null, due: null },
  ],
});

function clientWithBlocks(blocks: unknown[], rawLen = 500) {
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

describe("FullCardBuilder decisions + action_items", () => {
  test("extracts decisions[] and action_items[]{text,owner_raw,due,status}", async () => {
    const provider = createMockProvider(new Map([["", llmJson]]));
    const builder = new FullCardBuilder(
      clientWithBlocks([]) as never,
      provider,
      "mock-model",
      () => "2026-06-14T00:00:00Z",
    );
    const result = await builder.build(cand);
    expect(result.extract_level).toBe("full");
    if (result.extract_level !== "full") return;

    expect(result.decisions).toEqual([{ text: "Ship v2 next week", made_by_raw: "Alice" }]);

    expect(result.action_items).toEqual([
      {
        text: "Write the migration guide",
        owner_raw: "Bob",
        due: "2026-02-10",
        status: "open",
      },
      {
        text: "Schedule retro",
        status: "open",
      },
    ]);
  });

  test("defaults decisions/action_items to [] when the LLM omits them", async () => {
    const provider = createMockProvider(
      new Map([
        [
          "",
          JSON.stringify({
            purpose: "p",
            topics: ["t"],
            entities: [],
            overview: "o",
          }),
        ],
      ]),
    );
    const builder = new FullCardBuilder(
      clientWithBlocks([]) as never,
      provider,
      "mock-model",
      () => "2026-06-14T00:00:00Z",
    );
    const result = await builder.build(cand);
    expect(result.extract_level).toBe("full");
    if (result.extract_level !== "full") return;
    expect(result.decisions).toEqual([]);
    expect(result.action_items).toEqual([]);
  });
});

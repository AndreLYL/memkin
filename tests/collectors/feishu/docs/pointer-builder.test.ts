import { describe, expect, test } from "vitest";
import { buildPointerCard } from "../../../../src/collectors/feishu/docs/pointer-builder";
import type { DocCandidate } from "../../../../src/collectors/feishu/docs/types";

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

describe("buildPointerCard", () => {
  test("produces a pointer card with extracted_at", () => {
    const card = buildPointerCard(cand, "2026-06-14T00:00:00Z");
    expect(card.extract_level).toBe("pointer");
    expect(card.extracted_at).toBe("2026-06-14T00:00:00Z");
    expect(card.doc_token).toBe("t");
  });

  test("carries optional error/skip markers when provided", () => {
    const card = buildPointerCard(cand, "2026-06-14T00:00:00Z", { extract_error: "llm_timeout" });
    expect(card.extract_error).toBe("llm_timeout");
  });
});

import { describe, expect, test } from "vitest";
import { failedCards, summarizeCards } from "../../../../src/collectors/feishu/docs/status";

const fm = (over: Record<string, unknown>) => ({ frontmatter: over });

describe("summarizeCards", () => {
  test("counts pointer / full / failed", () => {
    const pages = [
      fm({ extract_level: "full" }),
      fm({ extract_level: "pointer" }),
      fm({ extract_level: "pointer", extract_error: "llm_timeout" }),
    ];
    expect(summarizeCards(pages as never)).toEqual({ total: 3, full: 1, pointer: 2, failed: 1 });
  });

  test("lists failed tokens", () => {
    const pages = [
      fm({ extract_level: "pointer", doc_token: "a", extract_error: "llm_timeout" }),
      fm({ extract_level: "full", doc_token: "b" }),
    ];
    expect(summarizeCards(pages as never).failed).toBe(1);
  });
});

describe("failedCards", () => {
  test("returns only cards with extract_error, with token + error", () => {
    const pages = [
      { frontmatter: { extract_level: "pointer", doc_token: "a", extract_error: "llm_timeout" } },
      { frontmatter: { extract_level: "full", doc_token: "b" } },
      { frontmatter: { extract_level: "pointer", extract_error: "llm_invalid_json" } }, // missing doc_token → "?"
    ];
    expect(failedCards(pages as never)).toEqual([
      { doc_token: "a", error: "llm_timeout" },
      { doc_token: "?", error: "llm_invalid_json" },
    ]);
  });
});

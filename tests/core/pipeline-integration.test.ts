import { describe, expect, test } from "vitest";
import { isEmptyExtraction } from "../../src/core/helpers.js";
import type { ExtractionResult } from "../../src/core/types.js";

describe("isEmptyExtraction", () => {
  test("truly empty result → true", () => {
    const result: ExtractionResult = {
      source: {
        platform: "feishu",
        channel: "test",
        timestamp: "2026-05-29T10:00:00Z",
        raw_hash: "",
        quote: "",
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [],
    };
    expect(isEmptyExtraction(result)).toBe(true);
  });

  test("result with one entity → false", () => {
    const result: ExtractionResult = {
      source: {
        platform: "feishu",
        channel: "test",
        timestamp: "2026-05-29T10:00:00Z",
        raw_hash: "",
        quote: "",
      },
      entities: [
        { slug: "person/alice", name: "Alice", type: "person", context: "", confidence: "direct" },
      ],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
      knowledge: [],
    };
    expect(isEmptyExtraction(result)).toBe(false);
  });
});

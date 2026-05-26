import { describe, it, expect } from "vitest";
import { parseSnippet } from "./highlight";

describe("parseSnippet", () => {
  it("splits FTS snippet with ** markers", () => {
    const result = parseSnippet("hello **world** foo");
    expect(result).toEqual([
      { text: "hello ", highlighted: false },
      { text: "world", highlighted: true },
      { text: " foo", highlighted: false },
    ]);
  });

  it("handles multiple highlights", () => {
    const result = parseSnippet("**a** b **c**");
    expect(result).toEqual([
      { text: "a", highlighted: true },
      { text: " b ", highlighted: false },
      { text: "c", highlighted: true },
    ]);
  });

  it("returns whole text as plain when no markers", () => {
    const result = parseSnippet("no markers here");
    expect(result).toEqual([{ text: "no markers here", highlighted: false }]);
  });

  it("handles empty string", () => {
    const result = parseSnippet("");
    expect(result).toEqual([{ text: "", highlighted: false }]);
  });
});

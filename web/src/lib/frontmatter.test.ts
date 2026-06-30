import { describe, it, expect } from "vitest";
import { parseFrontmatter, stripFrontmatter } from "./frontmatter";

describe("frontmatter", () => {
  it("parses key:value frontmatter", () => {
    const src = "---\ntitle: Hello\ntype: decision\n---\nbody text";
    expect(parseFrontmatter(src)).toEqual({ title: "Hello", type: "decision" });
  });
  it("returns empty object when no frontmatter", () => {
    expect(parseFrontmatter("just body")).toEqual({});
  });
  it("strips frontmatter leaving body", () => {
    expect(stripFrontmatter("---\na: 1\n---\nbody")).toBe("body");
  });
  it("returns full text when no frontmatter to strip", () => {
    expect(stripFrontmatter("body only")).toBe("body only");
  });
});

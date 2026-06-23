import { describe, expect, it } from "vitest";
import {
  buildSnippet,
  buildTrgmConditions,
  escapeIlikeTerm,
  splitTerms,
} from "../../src/store/trgm-search.js";

describe("splitTerms", () => {
  it("splits on whitespace, keeps intra-term chars", () => {
    expect(splitTerms("  刷新  gpt-4 ")).toEqual(["刷新", "gpt-4"]);
  });
  it("returns [] for empty/whitespace", () => {
    expect(splitTerms("   ")).toEqual([]);
  });
});

describe("escapeIlikeTerm", () => {
  it("escapes backslash first, then % and _", () => {
    expect(escapeIlikeTerm("a\\b%c_d")).toBe("a\\\\b\\%c\\_d");
  });
  it("leaves CJK and hyphen untouched", () => {
    expect(escapeIlikeTerm("中间件-x")).toBe("中间件-x");
  });
});

describe("buildTrgmConditions", () => {
  it("ANDs one OR-group per term and pushes %term% params", () => {
    const params: unknown[] = [];
    const sql = buildTrgmConditions(["刷新", "token"], ["p.title", "p.compiled_truth"], params);
    expect(sql).toBe(
      "(p.title ILIKE $1 ESCAPE '\\' OR p.compiled_truth ILIKE $1 ESCAPE '\\') AND " +
        "(p.title ILIKE $2 ESCAPE '\\' OR p.compiled_truth ILIKE $2 ESCAPE '\\')",
    );
    expect(params).toEqual(["%刷新%", "%token%"]);
  });
  it("returns null for no terms", () => {
    expect(buildTrgmConditions([], ["p.title"], [])).toBeNull();
  });
  it("offsets param indices by existing params", () => {
    const params: unknown[] = ["preexisting"];
    const sql = buildTrgmConditions(["x"], ["cc.chunk_text"], params);
    expect(sql).toBe("(cc.chunk_text ILIKE $2 ESCAPE '\\')");
    expect(params).toEqual(["preexisting", "%x%"]);
  });
});

describe("buildSnippet", () => {
  it("wraps first case-insensitive match in ** and adds ellipses", () => {
    const text = "前面一些上下文，这里讨论了认证中间件的重构决策，后面还有很多内容".repeat(1);
    const s = buildSnippet(text, ["认证中间件"], 6);
    expect(s).toContain("**认证中间件**");
  });
  it("is case-insensitive for ASCII", () => {
    expect(buildSnippet("hello GPT-4 world", ["gpt-4"])).toContain("**GPT-4**");
  });
  it("returns leading slice when no term matches", () => {
    expect(buildSnippet("abcdef", ["zzz"], 2)).toBe("abcd");
  });
  it("returns empty string for empty text", () => {
    expect(buildSnippet("", ["x"])).toBe("");
  });
});

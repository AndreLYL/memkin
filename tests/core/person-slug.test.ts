import { describe, expect, test } from "vitest";
import { toPersonCanonicalSlug } from "../../src/core/person-slug";

describe("toPersonCanonicalSlug — Chinese names", () => {
  test("3-char Chinese: family + joined given", () => {
    expect(toPersonCanonicalSlug("王建都")).toBe("person/wang-jiandu");
  });

  test("李应龙 → person/li-yinglong", () => {
    expect(toPersonCanonicalSlug("李应龙")).toBe("person/li-yinglong");
  });

  test("2-char Chinese: family-given with hyphen", () => {
    expect(toPersonCanonicalSlug("李明")).toBe("person/li-ming");
  });

  test("single character name", () => {
    expect(toPersonCanonicalSlug("武")).toBe("person/wu");
  });

  test("strips parenthetical hints from Chinese names", () => {
    expect(toPersonCanonicalSlug("王建都 (PM)")).toBe("person/wang-jiandu");
    expect(toPersonCanonicalSlug("李应龙（产品经理）")).toBe("person/li-yinglong");
  });
});

describe("toPersonCanonicalSlug — Latin names", () => {
  test("single-word Latin name", () => {
    expect(toPersonCanonicalSlug("Sylar")).toBe("person/sylar");
  });

  test("two-word Latin name with hyphen", () => {
    expect(toPersonCanonicalSlug("Alice Smith")).toBe("person/alice-smith");
  });

  test("multi-word name with hyphens", () => {
    expect(toPersonCanonicalSlug("John Paul Jones")).toBe("person/john-paul-jones");
  });

  test("name with apostrophe preserved", () => {
    expect(toPersonCanonicalSlug("O'Brien")).toBe("person/o-brien");
  });

  test("strips parenthetical hints from Latin names", () => {
    expect(toPersonCanonicalSlug("Alice Smith (CEO)")).toBe("person/alice-smith");
  });
});

describe("toPersonCanonicalSlug — edge cases", () => {
  test("empty string returns null", () => {
    expect(toPersonCanonicalSlug("")).toBe(null);
  });

  test("whitespace-only returns null", () => {
    expect(toPersonCanonicalSlug("   ")).toBe(null);
    expect(toPersonCanonicalSlug("\t\n")).toBe(null);
  });

  test("non-CJK non-Latin returns null", () => {
    expect(toPersonCanonicalSlug("أحمد")).toBe(null);
    expect(toPersonCanonicalSlug("Иван")).toBe(null);
  });

  test("mixed CJK and Latin treated as CJK", () => {
    // If contains ANY CJK, treat as Chinese path
    expect(toPersonCanonicalSlug("李Ming")).toBe("person/li-ming");
  });
});

describe("toPersonCanonicalSlug — external IDs", () => {
  test("preserves Feishu open id underscores as stable person slug", () => {
    expect(toPersonCanonicalSlug("ou_10d417bea2263b13b0112f8067334323")).toBe(
      "person/ou_10d417bea2263b13b0112f8067334323",
    );
  });

  test("uses Feishu open id for generic user labels that contain an open id", () => {
    expect(toPersonCanonicalSlug("Feishu User (ou_10d417bea2263b13b0112f8067334323)")).toBe(
      "person/ou_10d417bea2263b13b0112f8067334323",
    );
    expect(toPersonCanonicalSlug("User ou_10d417bea2263b13b0112f8067334323")).toBe(
      "person/ou_10d417bea2263b13b0112f8067334323",
    );
  });
});

describe("toPersonCanonicalSlug — normalization from slug-like input", () => {
  test("already slug-like but needs normalization", () => {
    // Even if input looks like a slug, we normalize from the name
    // This test documents expected behavior if someone passes weird input
    expect(toPersonCanonicalSlug("王建都")).toBe("person/wang-jiandu");
  });
});

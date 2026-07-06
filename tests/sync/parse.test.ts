import { describe, expect, it } from "vitest";
import {
  extractWikilinks,
  isValidSlug,
  parseVaultFile,
  slugifyPath,
  splitBody,
} from "../../src/sync/obsidian.js";

describe("splitBody", () => {
  it("splits all three sections in correct order", () => {
    const body =
      "main content\n\n<!-- memkin:related -->\n\n- [[a]]\n\n<!-- memkin:timeline -->\n\n- **2026-05-20**: e";
    const result = splitBody(body);
    expect(result.orderError).toBe(false);
    expect(result.mainBody).toBe("main content");
    expect(result.related).toContain("[[a]]");
    expect(result.timeline).toContain("2026-05-20");
  });

  it("handles only main body (no markers)", () => {
    const result = splitBody("just text");
    expect(result.orderError).toBe(false);
    expect(result.mainBody).toBe("just text");
    expect(result.related).toBe("");
    expect(result.timeline).toBe("");
  });

  it("handles only related marker", () => {
    const result = splitBody("main\n\n<!-- memkin:related -->\n\n- [[a]]");
    expect(result.orderError).toBe(false);
    expect(result.mainBody).toBe("main");
    expect(result.related).toContain("[[a]]");
  });

  it("M3: detects marker order reversal (timeline before related)", () => {
    const body = "main\n\n<!-- memkin:timeline -->\n\n- e\n\n<!-- memkin:related -->\n\n- [[a]]";
    const result = splitBody(body);
    expect(result.orderError).toBe(true);
  });

  it("handles empty body", () => {
    const result = splitBody("");
    expect(result.orderError).toBe(false);
    expect(result.mainBody).toBe("");
  });
});

describe("isValidSlug (H3 + L6)", () => {
  it("accepts simple ASCII slug", () => {
    expect(isValidSlug("person/alice")).toBe(true);
  });

  it("accepts Unicode slug (H3: Chinese)", () => {
    expect(isValidSlug("person/王志冲")).toBe(true);
  });

  it("accepts Unicode slug (Japanese)", () => {
    expect(isValidSlug("entity/太郎")).toBe(true);
  });

  it("rejects empty slug", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("rejects slug with spaces", () => {
    expect(isValidSlug("person alice")).toBe(false);
  });

  it("rejects slug with special chars", () => {
    expect(isValidSlug("person/alice!")).toBe(false);
    expect(isValidSlug("person/alice@home")).toBe(false);
  });

  it("L6: rejects Windows reserved names", () => {
    expect(isValidSlug("con")).toBe(false);
    expect(isValidSlug("path/con")).toBe(false);
    expect(isValidSlug("path/CON")).toBe(false); // case-insensitive
    expect(isValidSlug("path/nul/sub")).toBe(false);
    expect(isValidSlug("path/aux")).toBe(false);
    expect(isValidSlug("path/com1")).toBe(false);
    expect(isValidSlug("path/lpt9")).toBe(false);
  });

  it("L6: rejects slugs longer than 200 chars", () => {
    expect(isValidSlug("a".repeat(201))).toBe(false);
    expect(isValidSlug("a".repeat(200))).toBe(true);
  });
});

describe("slugifyPath", () => {
  it("converts simple path to slug", () => {
    expect(slugifyPath("person/alice.md")).toBe("person/alice");
  });

  it("converts nested path", () => {
    expect(slugifyPath("knowledge/typescript/abc.md")).toBe("knowledge/typescript/abc");
  });

  it("strips leading ./ and slashes", () => {
    expect(slugifyPath("./person/alice.md")).toBe("person/alice");
    expect(slugifyPath("/person/alice.md")).toBe("person/alice");
  });

  it("preserves Unicode", () => {
    expect(slugifyPath("person/王志冲.md")).toBe("person/王志冲");
  });
});

describe("extractWikilinks", () => {
  it("extracts plain [[slug]]", () => {
    expect(extractWikilinks("see [[person/alice]] for context")).toEqual(["person/alice"]);
  });

  it("extracts [[slug|display]] format (drops display)", () => {
    expect(extractWikilinks("see [[person/alice|Alice]]")).toEqual(["person/alice"]);
  });

  it("handles multiple wikilinks", () => {
    expect(extractWikilinks("[[a]] and [[b]] and [[c|C]]")).toEqual(["a", "b", "c"]);
  });

  it("returns empty array when no wikilinks", () => {
    expect(extractWikilinks("just text, no links")).toEqual([]);
  });

  it("handles Unicode in wikilinks", () => {
    expect(extractWikilinks("see [[person/王志冲]]")).toEqual(["person/王志冲"]);
  });
});

describe("parseVaultFile", () => {
  const validContent = `---
title: Alice
type: person
slug: person/alice
tags:
  - entity
  - person
links:
  - target: project/auth
    type: works_on
  - target: person/bob
    type: obsidian
content_hash: abc
user_edited: false
---

## Context

Senior engineer.
`;

  it("parses frontmatter and body correctly", () => {
    const result = parseVaultFile(validContent, "person/alice.md");
    expect(result.slug).toBe("person/alice");
    expect(result.tags).toEqual(["entity", "person"]);
    expect(result.cleanMarkdown).toContain("## Context");
    expect(result.cleanMarkdown).toContain("Senior engineer");
  });

  it("H2-incomplete: filters out non-obsidian pipeline links", () => {
    const result = parseVaultFile(validContent, "person/alice.md");
    // works_on link should be filtered out; only obsidian remains
    expect(result.links).toEqual(["person/bob"]);
    expect(result.links).not.toContain("project/auth");
  });

  it("H2-incomplete: plain string links (legacy) treated as obsidian", () => {
    const content = `---
title: A
type: t
slug: a
links:
  - just-a-slug
  - person/bob
---

body`;
    const result = parseVaultFile(content, "a.md");
    expect(result.links).toContain("just-a-slug");
    expect(result.links).toContain("person/bob");
  });

  it("merges frontmatter.links with body wikilinks", () => {
    const content = `---
title: A
type: t
slug: a
links:
  - target: x
    type: obsidian
---

See [[y]] and [[z|Display]].
`;
    const result = parseVaultFile(content, "a.md");
    expect(result.links.sort()).toEqual(["x", "y", "z"]);
  });

  it("H4: injects user_edited=true into cleanMarkdown frontmatter", () => {
    const result = parseVaultFile(validContent, "person/alice.md");
    expect(result.cleanMarkdown).toContain("user_edited: true");
  });

  it("L4: ignores body ## Aliases section (frontmatter is authority)", () => {
    const content = `---
title: A
type: t
slug: a
aliases:
  - from-fm
---

## Aliases

- from-body

## Context

C`;
    const result = parseVaultFile(content, "a.md");
    // body Aliases NOT parsed into tags or other; aliases come from frontmatter only
    expect(result.cleanMarkdown).toContain("aliases:");
    expect(result.cleanMarkdown).toContain("from-fm");
    // cleanMarkdown still contains body ## Aliases (it's compiled_truth);
    // re-serialization will strip and regenerate. No tags from body parsing.
    expect(result.tags).toEqual([]);
  });

  it("M3: throws on marker order reversal", () => {
    const content = `---
title: A
type: t
slug: a
---

body

<!-- memkin:timeline -->

- e

<!-- memkin:related -->

- [[x]]
`;
    expect(() => parseVaultFile(content, "a.md")).toThrow(/marker order/i);
  });

  it("M7: ignores timeline section entirely (export-only)", () => {
    const content = `---
title: A
type: t
slug: a
---

body

<!-- memkin:timeline -->

- **2026-05-20**: from vault
`;
    const result = parseVaultFile(content, "a.md");
    // No timeline field returned (M7 makes it export-only)
    expect(result).not.toHaveProperty("timeline");
    expect(result).not.toHaveProperty("timelineEntries");
    // cleanMarkdown's main body shouldn't include the timeline section
    expect(result.cleanMarkdown).not.toContain("from vault");
  });

  it("derives slug from path when frontmatter.slug absent", () => {
    const content = `---
title: A
type: t
---

body`;
    const result = parseVaultFile(content, "person/alice.md");
    expect(result.slug).toBe("person/alice");
  });

  it("throws on invalid slug", () => {
    const content = `---
title: A
type: t
slug: "with spaces"
---

body`;
    expect(() => parseVaultFile(content, "x.md")).toThrow(/invalid slug/i);
  });

  it("strips sync-only metadata fields from cleanMarkdown", () => {
    const result = parseVaultFile(validContent, "person/alice.md");
    expect(result.cleanMarkdown).not.toContain("content_hash:");
    expect(result.cleanMarkdown).not.toContain("slug:");
    // tags/links removed from frontmatter (handled separately)
    expect(result.cleanMarkdown).not.toMatch(/^tags:/m);
    expect(result.cleanMarkdown).not.toMatch(/^links:/m);
  });
});

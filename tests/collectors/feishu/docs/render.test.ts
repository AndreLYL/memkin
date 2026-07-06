import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  mergeUserNoteIntoCard,
  renderDocCardMarkdown,
} from "../../../../src/collectors/feishu/docs/render";
import type { FullCard, PointerCard } from "../../../../src/collectors/feishu/docs/types";

function full(over: Partial<FullCard> = {}): FullCard {
  return {
    doc_token: "tok123",
    doc_type: "docx",
    title: "My Doc",
    url: "https://feishu.cn/docx/tok123",
    owner_id: "ou_owner",
    last_editor_id: "ou_me",
    created_at: "2026-01-01T00:00:00Z",
    modified_at: "2026-06-01T00:00:00Z",
    source: { kind: "my_space", folder_token: "fld_a" },
    parent_path: "My Space/Research/",
    extract_level: "full",
    purpose: "Track the memkin roadmap",
    topics: ["roadmap", "memkin"],
    entities: [{ name: "Memkin", type_guess: "project" }],
    toc: [{ level: 1, title: "Goals" }],
    overview: "An overview of the roadmap.",
    source_body_hash: "abc",
    summary_generated_at: "2026-06-02T00:00:00Z",
    summary_model: "MiniMax-M2.5",
    extracted_at: "2026-06-02T00:00:00Z",
    ...over,
  };
}

function pointer(over: Partial<PointerCard> = {}): PointerCard {
  return {
    doc_token: "tok123",
    doc_type: "docx",
    title: "My Doc",
    url: "https://feishu.cn/docx/tok123",
    owner_id: "ou_owner",
    last_editor_id: "ou_me",
    created_at: "2026-01-01T00:00:00Z",
    modified_at: "2026-06-01T00:00:00Z",
    source: { kind: "my_space", folder_token: "fld_a" },
    parent_path: "My Space/Research/",
    extract_level: "pointer",
    extracted_at: "2026-06-02T00:00:00Z",
    ...over,
  };
}

function frontmatterOf(markdown: string): Record<string, unknown> {
  const m = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error("no frontmatter");
  return parseYaml(m[1]) as Record<string, unknown>;
}

describe("renderDocCardMarkdown — full card", () => {
  const md = renderDocCardMarkdown(full());

  test("starts with a YAML frontmatter block", () => {
    expect(md.startsWith("---\n")).toBe(true);
  });

  test("frontmatter carries title and type for putPage to lift", () => {
    const fm = frontmatterOf(md);
    expect(fm.title).toBe("My Doc");
    expect(fm.type).toBe("feishu_doc_card");
  });

  test("nested fields round-trip through YAML", () => {
    const fm = frontmatterOf(md) as { entities: unknown; toc: unknown };
    expect(fm.entities).toEqual([{ name: "Memkin", type_guess: "project" }]);
    expect(fm.toc).toEqual([{ level: 1, title: "Goals" }]);
  });

  test("source_body_hash is preserved, no content_hash key", () => {
    const fm = frontmatterOf(md);
    expect(fm.source_body_hash).toBe("abc");
    expect(fm.content_hash).toBeUndefined();
  });

  test("body renders purpose, overview, topics and back-link", () => {
    const body = md.split(/\n---\n/)[1];
    expect(body).toContain("Track the memkin roadmap");
    expect(body).toContain("An overview of the roadmap.");
    expect(body).toContain("- roadmap");
    expect(body).toContain("https://feishu.cn/docx/tok123");
  });
});

describe("renderDocCardMarkdown — pointer card", () => {
  const md = renderDocCardMarkdown(pointer());

  test("type is feishu_doc_card and extract_level pointer", () => {
    const fm = frontmatterOf(md);
    expect(fm.type).toBe("feishu_doc_card");
    expect(fm.extract_level).toBe("pointer");
  });

  test("body says summary not yet generated", () => {
    expect(md).toContain("Pointer card");
  });

  test("includes last error when present", () => {
    const md2 = renderDocCardMarkdown(pointer({ extract_error: "llm_timeout" }));
    expect(md2).toContain("llm_timeout");
  });
});

describe("mergeUserNoteIntoCard", () => {
  test("forces purpose to the user note and sets user_note", () => {
    const merged = mergeUserNoteIntoCard(full({ purpose: "llm guess" }), "the real purpose");
    expect(merged.purpose).toBe("the real purpose");
    expect(merged.user_note).toBe("the real purpose");
  });

  test("does not mutate the input", () => {
    const card = full({ purpose: "llm guess" });
    mergeUserNoteIntoCard(card, "override");
    expect(card.purpose).toBe("llm guess");
  });
});

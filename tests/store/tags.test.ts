import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";
import { TagStore } from "../../src/store/tags.js";

describe("TagStore", () => {
  let db: Database;
  let pages: PageStore;
  let tags: TagStore;

  beforeEach(async () => {
    db = await Database.create();
    pages = new PageStore(db.pg);
    tags = new TagStore(db.pg);
  });
  afterEach(async () => {
    await db.close();
  });

  it("addTag and getTags", async () => {
    await pages.putPage("test/tagged", "---\ntitle: T\ntype: test\n---\nBody.");
    await tags.addTag("test/tagged", "important");
    await tags.addTag("test/tagged", "review");
    const result = await tags.getTags("test/tagged");
    expect(result).toContain("important");
    expect(result).toContain("review");
    expect(result).toHaveLength(2);
  });

  it("addTag is idempotent (upsert)", async () => {
    await pages.putPage("test/dup", "---\ntitle: D\ntype: test\n---\nBody.");
    await tags.addTag("test/dup", "same");
    await tags.addTag("test/dup", "same");
    const result = await tags.getTags("test/dup");
    expect(result).toHaveLength(1);
  });

  it("removeTag deletes a tag", async () => {
    await pages.putPage("test/rm", "---\ntitle: R\ntype: test\n---\nBody.");
    await tags.addTag("test/rm", "a");
    await tags.addTag("test/rm", "b");
    await tags.removeTag("test/rm", "a");
    const result = await tags.getTags("test/rm");
    expect(result).toEqual(["b"]);
  });

  it("getTags returns empty array for untagged page", async () => {
    await pages.putPage("test/notag", "---\ntitle: N\ntype: test\n---\nBody.");
    const result = await tags.getTags("test/notag");
    expect(result).toEqual([]);
  });

  it("tags cascade on page delete", async () => {
    await pages.putPage("test/cascade", "---\ntitle: C\ntype: test\n---\nBody.");
    await tags.addTag("test/cascade", "temp");
    await pages.deletePage("test/cascade");
    const count = await db.pg.query("SELECT COUNT(*) AS c FROM tags");
    expect(Number(count.rows[0].c)).toBe(0);
  });

  it("getAllTagsGrouped returns Map<slug, string[]> for batch export", async () => {
    await pages.putPage("a", "---\ntitle: A\ntype: t\n---\n");
    await pages.putPage("b", "---\ntitle: B\ntype: t\n---\n");
    await tags.addTag("a", "x");
    await tags.addTag("a", "y");
    await tags.addTag("b", "z");

    const grouped = await tags.getAllTagsGrouped();

    expect(grouped.get("a")?.sort()).toEqual(["x", "y"]);
    expect(grouped.get("b")).toEqual(["z"]);
    expect(grouped.has("nonexistent")).toBe(false);
  });

  it("getAllTagsGrouped returns empty Map when no tags", async () => {
    const grouped = await tags.getAllTagsGrouped();
    expect(grouped.size).toBe(0);
  });
});

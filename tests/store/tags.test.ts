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

  it("addTag rejects missing page slugs instead of silently inserting zero rows", async () => {
    await expect(tags.addTag("missing/page", "same")).rejects.toThrow(
      "Page not found: missing/page",
    );
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
});

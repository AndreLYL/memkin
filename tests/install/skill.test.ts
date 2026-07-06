import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMKIN_SKILL, scaffoldSkill } from "../../src/install/skill.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memkin-skill-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("memkin skill", () => {
  it("has frontmatter name and the key guidance", () => {
    expect(MEMKIN_SKILL).toContain("name: memkin");
    expect(MEMKIN_SKILL).toContain("`search`");
    expect(MEMKIN_SKILL).toContain("get_session_context");
    expect(MEMKIN_SKILL).toContain("Writing back");
    expect(MEMKIN_SKILL).toContain("generic questions");
  });

  it("scaffolds SKILL.md and is idempotent", () => {
    const path = scaffoldSkill(dir);
    expect(path).toBe(join(dir, "memkin", "SKILL.md"));
    expect(readFileSync(path, "utf8")).toBe(MEMKIN_SKILL);
    // re-scaffold overwrites without throwing
    expect(() => scaffoldSkill(dir)).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe(MEMKIN_SKILL);
  });
});

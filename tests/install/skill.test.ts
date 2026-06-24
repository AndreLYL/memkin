import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMOARK_SKILL, scaffoldSkill } from "../../src/install/skill.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "memoark-skill-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("memoark skill", () => {
  it("has frontmatter name and the key guidance", () => {
    expect(MEMOARK_SKILL).toContain("name: memoark");
    expect(MEMOARK_SKILL).toContain("`search`");
    expect(MEMOARK_SKILL).toContain("get_session_context");
    expect(MEMOARK_SKILL).toContain("Writing back");
    expect(MEMOARK_SKILL).toContain("generic questions");
  });

  it("scaffolds SKILL.md and is idempotent", () => {
    const path = scaffoldSkill(dir);
    expect(path).toBe(join(dir, "memoark", "SKILL.md"));
    expect(readFileSync(path, "utf8")).toBe(MEMOARK_SKILL);
    // re-scaffold overwrites without throwing
    expect(() => scaffoldSkill(dir)).not.toThrow();
    expect(readFileSync(path, "utf8")).toBe(MEMOARK_SKILL);
  });
});

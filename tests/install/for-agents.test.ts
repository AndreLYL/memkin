import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const doc = join(root, "MEMKIN_FOR_AGENTS.md");

describe("MEMKIN_FOR_AGENTS.md", () => {
  it("exists with frontmatter and installer framing", () => {
    expect(existsSync(doc)).toBe(true);
    const text = readFileSync(doc, "utf8");
    expect(text.startsWith("---")).toBe(true);
    expect(text).toContain("id: memkin-install");
    expect(text).toContain("version:");
    expect(text).toContain("You are the installer");
  });

  it("references the real install commands", () => {
    const text = readFileSync(doc, "utf8");
    expect(text).toContain("memkin install");
    expect(text).toContain("memkin hooks install");
    expect(text).toContain("memkin skill scaffold");
    expect(text).toMatch(/query|get_health/);
  });
});

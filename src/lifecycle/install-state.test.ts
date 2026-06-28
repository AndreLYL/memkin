import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { opKey, readInstallState, recordOriginal, restorableOriginal } from "./install-state.js";

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "memoark-is-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const op = {
  client: "claude-code",
  scope: "global" as const,
  path: "/h/.claude.json",
  op_kind: "json-mcp",
};

describe("install-state", () => {
  it("opKey is composite", () => {
    expect(opKey(op)).toBe("claude-code|global|/h/.claude.json|json-mcp");
  });
  it("readInstallState returns empty ops when absent", () => {
    expect(readInstallState(home)).toEqual({ ops: [] });
  });
  it("first backup wins; managed_hash gates restore", () => {
    recordOriginal(home, op, { present: false, raw: null }, "hashA");
    recordOriginal(home, op, { present: true, raw: "later" }, "hashB"); // original must NOT change
    const stored = readInstallState(home).ops.find((o) => opKey(o) === opKey(op));
    expect(stored?.original).toEqual({ present: false, raw: null });
    expect(restorableOriginal(home, op, "hashB")).toEqual({ present: false, raw: null }); // managed_hash updated to hashB
    expect(restorableOriginal(home, op, "DIFFERENT")).toBeNull();
  });
});

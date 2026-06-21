import { describe, expect, it } from "vitest";
import { applyFetchMode, type FetchMode, fetchModeFromConfig } from "./fetch-mode.js";

const cfg = (over: Record<string, unknown> = {}) =>
  ({ sources: { feishu: { enabled: true, chat_ids: ["oc_1"], auto_include_new_groups: false, ...over } } }) as never;

describe("fetch-mode", () => {
  it("derives 'curated' when auto_include_new_groups is false/absent", () => {
    expect(fetchModeFromConfig(cfg())).toBe("curated");
    expect(fetchModeFromConfig({ sources: { feishu: { enabled: true } } } as never)).toBe("curated");
  });
  it("derives 'autonomous' when auto_include_new_groups is true", () => {
    expect(fetchModeFromConfig(cfg({ auto_include_new_groups: true }))).toBe("autonomous");
  });
  it("applyFetchMode('autonomous') sets the flag true, preserving chat_ids", () => {
    const patch = applyFetchMode(cfg(), "autonomous");
    expect(patch.sources?.feishu?.auto_include_new_groups).toBe(true);
    expect(patch.sources?.feishu?.chat_ids).toEqual(["oc_1"]);
  });
  it("applyFetchMode('curated') sets the flag false", () => {
    const patch = applyFetchMode(cfg({ auto_include_new_groups: true }), "curated");
    expect(patch.sources?.feishu?.auto_include_new_groups).toBe(false);
  });
  it("preserves other sources siblings in the patch", () => {
    const c = { sources: { feishu: { enabled: true }, "claude-code": { enabled: true } } } as never;
    const patch = applyFetchMode(c, "autonomous");
    expect((patch.sources as Record<string, unknown>)["claude-code"]).toEqual({ enabled: true });
  });
});

import { describe, expect, test } from "vitest";
import { evaluateTriggers } from "../../../../src/collectors/feishu/docs/triggers";
import type { DocCandidate, DocDecisionConfig } from "../../../../src/collectors/feishu/docs/types";

const NOW = Date.parse("2026-06-14T00:00:00Z");

function candidate(over: Partial<DocCandidate> = {}): DocCandidate {
  return {
    doc_token: "tok",
    doc_type: "docx",
    title: "t",
    url: "u",
    owner_id: "ou_owner",
    last_editor_id: "ou_other",
    created_at: "2020-01-01T00:00:00Z",
    modified_at: "2020-01-01T00:00:00Z",
    source: { kind: "my_space", folder_token: "fld_a" },
    parent_path: "My Space/",
    ...over,
  };
}

function config(over: Partial<DocDecisionConfig> = {}): DocDecisionConfig {
  return {
    self_edit: true,
    recent_window_days: null,
    important_folders: [],
    important_wiki_spaces: [],
    ...over,
  };
}

describe("evaluateTriggers", () => {
  test("T1 fires when last editor is self and self_edit on", () => {
    const c = candidate({ last_editor_id: "ou_me" });
    expect(evaluateTriggers(c, config(), "ou_me", NOW)).toBe("T1");
  });

  test("T1 does not fire when self_edit disabled", () => {
    const c = candidate({ last_editor_id: "ou_me" });
    expect(evaluateTriggers(c, config({ self_edit: false }), "ou_me", NOW)).toBe(null);
  });

  test("T2 off by default (recent_window_days null) → no fire on recent doc", () => {
    const c = candidate({ modified_at: "2026-06-13T00:00:00Z" });
    expect(evaluateTriggers(c, config(), "ou_me", NOW)).toBe(null);
  });

  test("T2 fires when within window", () => {
    const c = candidate({ modified_at: "2026-06-01T00:00:00Z" });
    expect(evaluateTriggers(c, config({ recent_window_days: 90 }), "ou_me", NOW)).toBe("T2");
  });

  test("T2 does not fire outside window", () => {
    const c = candidate({ modified_at: "2025-01-01T00:00:00Z" });
    expect(evaluateTriggers(c, config({ recent_window_days: 90 }), "ou_me", NOW)).toBe(null);
  });

  test("T4 fires for important folder", () => {
    const c = candidate({ source: { kind: "folder", folder_token: "fld_x", folder_name: "X" } });
    expect(evaluateTriggers(c, config({ important_folders: ["fld_x"] }), "ou_me", NOW)).toBe("T4");
  });

  test("T4 fires for important folder when source is my_space", () => {
    const c = candidate({ source: { kind: "my_space", folder_token: "fld_x" } });
    expect(evaluateTriggers(c, config({ important_folders: ["fld_x"] }), "ou_me", NOW)).toBe("T4");
  });

  test("T4 fires for important wiki space", () => {
    const c = candidate({
      source: { kind: "wiki", space_id: "sp_1", space_name: "S", node_token: "nd_1" },
    });
    expect(evaluateTriggers(c, config({ important_wiki_spaces: ["sp_1"] }), "ou_me", NOW)).toBe(
      "T4",
    );
  });

  test("no trigger fires → null", () => {
    expect(evaluateTriggers(candidate(), config(), "ou_me", NOW)).toBe(null);
  });
});

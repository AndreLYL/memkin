import { describe, expect, test } from "vitest";
import { decide, decideAfterBodyCheck } from "../../../../src/collectors/feishu/docs/decision";
import type {
  DocCandidate,
  DocCard,
  DocDecisionConfig,
  FullCard,
  PointerCard,
} from "../../../../src/collectors/feishu/docs/types";

const NOW = Date.parse("2026-06-14T00:00:00Z");
const SELF = "ou_me";

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

function pointer(over: Partial<PointerCard> = {}): PointerCard {
  return { ...candidate(), extract_level: "pointer", extracted_at: "2020-01-01T00:00:00Z", ...over };
}

function full(over: Partial<FullCard> = {}): FullCard {
  return {
    ...candidate(),
    extract_level: "full",
    purpose: "p",
    topics: [],
    entities: [],
    toc: [],
    overview: "o",
    source_body_hash: "hash_old",
    summary_generated_at: "2020-01-01T00:00:00Z",
    summary_model: "m",
    extracted_at: "2020-01-01T00:00:00Z",
    ...over,
  };
}

describe("decide — gate", () => {
  test("non-docx → save_pointer", () => {
    const c = { ...candidate(), doc_type: "sheet" as unknown as "docx" };
    expect(decide(c, null, config(), SELF, NOW)).toEqual({
      action: "save_pointer",
      reason: "non_docx",
    });
  });
});

describe("decide — no existing card", () => {
  test("gate pass + no trigger → save_pointer", () => {
    const d = decide(candidate(), null, config(), SELF, NOW);
    expect(d).toEqual({ action: "save_pointer", reason: "no_trigger" });
  });

  test("gate pass + trigger fires → queue_for_upgrade", () => {
    const c = candidate({ last_editor_id: SELF });
    expect(decide(c, null, config(), SELF, NOW)).toEqual({
      action: "queue_for_upgrade",
      trigger: "T1",
    });
  });
});

describe("decide — existing pointer card", () => {
  const existing: DocCard = pointer({ modified_at: "2020-01-01T00:00:00Z" });

  test("unchanged + triggers now satisfied → queue_for_upgrade (config-change edge)", () => {
    const c = candidate({ modified_at: "2020-01-01T00:00:00Z", last_editor_id: SELF });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({
      action: "queue_for_upgrade",
      trigger: "T1",
    });
  });

  test("unchanged + still no trigger → skip_save", () => {
    const c = candidate({ modified_at: "2020-01-01T00:00:00Z" });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({ action: "skip_save" });
  });

  test("modified changed + no trigger → save_pointer (metadata refresh)", () => {
    const c = candidate({ modified_at: "2026-06-10T00:00:00Z" });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({
      action: "save_pointer",
      reason: "metadata_refresh",
    });
  });

  test("modified changed + trigger → queue_for_upgrade", () => {
    const c = candidate({ modified_at: "2026-06-10T00:00:00Z", last_editor_id: SELF });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({
      action: "queue_for_upgrade",
      trigger: "T1",
    });
  });
});

describe("decide — existing full card", () => {
  const existing: DocCard = full({ modified_at: "2020-01-01T00:00:00Z" });

  test("modified unchanged → skip_save", () => {
    const c = candidate({ modified_at: "2020-01-01T00:00:00Z" });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({ action: "skip_save" });
  });

  test("modified changed → needs_body_check", () => {
    const c = candidate({ modified_at: "2026-06-10T00:00:00Z" });
    expect(decide(c, existing, config(), SELF, NOW)).toEqual({ action: "needs_body_check" });
  });
});

describe("decideAfterBodyCheck", () => {
  test("hash unchanged → metadata_refresh", () => {
    expect(decideAfterBodyCheck("h1", "h1")).toEqual({ action: "metadata_refresh" });
  });

  test("hash changed → queue_for_upgrade (T5)", () => {
    expect(decideAfterBodyCheck("h2", "h1")).toEqual({
      action: "queue_for_upgrade",
      trigger: "T5",
    });
  });
});

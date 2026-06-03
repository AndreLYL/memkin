import { describe, expect, it } from "vitest";
import { createDefaultConfigDocument, updateDraft } from "../../src/config-center/document.js";
import {
  configCenterReducer,
  createInitialState,
  getCurrentField,
  getCurrentFields,
} from "../../src/config-center/reducer.js";
import type { DetectedSource } from "../../src/setup/detect-sources.js";

const SOURCE_DETECTIONS: DetectedSource[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    detected: true,
    path: "/Users/test/.claude/projects",
    message: "Found sessions at /Users/test/.claude/projects",
  },
  {
    id: "codex",
    name: "Codex",
    detected: false,
    path: "/Users/test/.codex",
    message: "Directory exists but no sessions",
  },
  {
    id: "hermes",
    name: "Hermes",
    detected: true,
    path: "/Users/test/.openclaw/agents",
    message: "Found sessions at /Users/test/.openclaw/agents",
  },
];

describe("config-center reducer", () => {
  it("navigates sections and fields", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const nextSection = configCenterReducer(initial, { type: "nextSection" });
    const fields = configCenterReducer(nextSection, { type: "focusFields" });
    const nextField = configCenterReducer(fields, { type: "nextField" });

    expect(initial.focus).toBe("sections");
    expect(nextSection.sectionId).toBe("llm");
    expect(getCurrentFields(nextSection)[0]?.path).toBe("llm.provider");
    expect(fields.focus).toBe("fields");
    expect(fields.fieldIndex).toBe(0);
    expect(getCurrentField(nextField)?.path).toBe("llm.model");
  });

  it("returns to section focus from field focus", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const llm = configCenterReducer(initial, { type: "selectSection", sectionId: "llm" });
    const fields = configCenterReducer(llm, { type: "focusFields" });
    const sections = configCenterReducer(fields, { type: "focusSections" });

    expect(fields.focus).toBe("fields");
    expect(sections.focus).toBe("sections");
    expect(sections.editing).toBe(false);
  });

  it("resets the field cursor when entering field focus", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const llm = configCenterReducer(initial, { type: "selectSection", sectionId: "llm" });
    const fields = configCenterReducer(llm, { type: "focusFields" });
    const model = configCenterReducer(fields, { type: "nextField" });
    const sections = configCenterReducer(model, { type: "focusSections" });
    const reentered = configCenterReducer(sections, { type: "focusFields" });

    expect(model.fieldIndex).toBe(1);
    expect(reentered.focus).toBe("fields");
    expect(reentered.fieldIndex).toBe(0);
  });

  it("keeps sidebar focus when the selected section has no configurable fields", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const overviewFields = configCenterReducer(initial, { type: "focusFields" });
    const feishu = configCenterReducer(initial, { type: "selectSection", sectionId: "feishu" });
    const feishuFields = configCenterReducer(feishu, { type: "focusFields" });

    expect(overviewFields.focus).toBe("sections");
    expect(overviewFields.sectionId).toBe("overview");
    expect(feishuFields.focus).toBe("sections");
    expect(feishuFields.sectionId).toBe("feishu");
  });

  it("toggles boolean fields and marks state dirty", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const sources = configCenterReducer(initial, { type: "selectSection", sectionId: "sources" });
    const fields = configCenterReducer(sources, { type: "focusFields" });
    const toggled = configCenterReducer(fields, { type: "toggleCurrentField" });

    expect(toggled.doc.draft.sources?.["claude-code"]?.enabled).toBe(false);
    expect(toggled.dirty).toBe(true);
  });

  it("does not toggle or edit fields while the sidebar is focused", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const sources = configCenterReducer(initial, { type: "selectSection", sectionId: "sources" });
    const toggled = configCenterReducer(sources, { type: "toggleCurrentField" });
    const editing = configCenterReducer(sources, { type: "startEditing" });

    expect(toggled.doc.draft.sources?.["claude-code"]?.enabled).toBe(true);
    expect(toggled.dirty).toBe(false);
    expect(editing.editing).toBe(false);
  });

  it("commits string edits to the current field", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const llm = configCenterReducer(initial, { type: "selectSection", sectionId: "llm" });
    const fields = configCenterReducer(llm, { type: "focusFields" });
    const model = configCenterReducer(fields, { type: "nextField" });
    const editing = configCenterReducer(model, { type: "startEditing" });
    const committed = configCenterReducer(editing, { type: "commitEditing", value: "gpt-test" });

    expect(committed.doc.draft.llm?.model).toBe("gpt-test");
    expect(committed.editing).toBe(false);
    expect(committed.dirty).toBe(true);
  });

  it("commits edits and switches fields when navigating during editing", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const llm = configCenterReducer(initial, { type: "selectSection", sectionId: "llm" });
    const fields = configCenterReducer(llm, { type: "focusFields" });
    const model = configCenterReducer(fields, { type: "nextField" });
    const editing = configCenterReducer(model, { type: "startEditing" });
    const typed = configCenterReducer(editing, { type: "setEditValue", value: "gpt-test" });
    const next = configCenterReducer(typed, {
      type: "commitEditingAndMoveField",
      direction: "next",
    });

    expect(next.doc.draft.llm?.model).toBe("gpt-test");
    expect(next.editing).toBe(false);
    expect(next.fieldIndex).toBe(2);
    expect(getCurrentField(next)?.path).toBe("llm.base_url");
  });

  it("filters embedding fields by the selected provider", () => {
    const initial = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const embedding = configCenterReducer(initial, {
      type: "selectSection",
      sectionId: "embedding",
    });
    const ollama = {
      ...embedding,
      doc: updateDraft(embedding.doc, "embedding.provider", "ollama"),
    };

    expect(getCurrentFields(embedding).map((field) => field.path)).toContain("embedding.api_key");
    expect(getCurrentFields(ollama).map((field) => field.path)).toEqual([
      "embedding.provider",
      "embedding.model",
      "embedding.dimensions",
      "embedding.base_url",
    ]);
  });

  it("skips hidden embedding fields during field navigation", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memoark.yaml"),
      "embedding.provider",
      "ollama",
    );
    const initial = createInitialState(doc);
    const embedding = configCenterReducer(initial, {
      type: "selectSection",
      sectionId: "embedding",
    });
    const fields = configCenterReducer(embedding, { type: "focusFields" });
    const model = configCenterReducer(fields, { type: "nextField" });
    const dimensions = configCenterReducer(model, { type: "nextField" });
    const baseUrl = configCenterReducer(dimensions, { type: "nextField" });

    expect(getCurrentField(model)?.path).toBe("embedding.model");
    expect(getCurrentField(dimensions)?.path).toBe("embedding.dimensions");
    expect(getCurrentField(baseUrl)?.path).toBe("embedding.base_url");
  });

  it("hydrates enabled source base dirs from detected source paths on initial load", () => {
    const initial = createInitialState(
      createDefaultConfigDocument("/tmp/memoark.yaml"),
      SOURCE_DETECTIONS,
    );

    expect(initial.doc.draft.sources?.["claude-code"]?.base_dir).toBe(
      "/Users/test/.claude/projects",
    );
    expect(initial.doc.draft.sources?.hermes?.base_dir).toBe("/Users/test/.openclaw/agents");
    expect(initial.doc.draft.sources?.codex?.base_dir).toBeUndefined();
  });

  it("writes a detected source base dir when enabling a source", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memoark.yaml"),
      "sources.claude-code.enabled",
      false,
    );
    const initial = createInitialState(doc, SOURCE_DETECTIONS);
    const sources = configCenterReducer(initial, { type: "selectSection", sectionId: "sources" });
    const fields = configCenterReducer(sources, { type: "focusFields" });
    const toggled = configCenterReducer(fields, {
      type: "toggleCurrentField",
      sourceDetections: SOURCE_DETECTIONS,
    });

    expect(toggled.doc.draft.sources?.["claude-code"]?.enabled).toBe(true);
    expect(toggled.doc.draft.sources?.["claude-code"]?.base_dir).toBe(
      "/Users/test/.claude/projects",
    );
  });

  it("clears a source base dir when disabling a source", () => {
    const withPath = updateDraft(
      createDefaultConfigDocument("/tmp/memoark.yaml"),
      "sources.claude-code.base_dir",
      "/Users/test/.claude/projects",
    );
    const initial = createInitialState(withPath, SOURCE_DETECTIONS);
    const sources = configCenterReducer(initial, { type: "selectSection", sectionId: "sources" });
    const fields = configCenterReducer(sources, { type: "focusFields" });
    const toggled = configCenterReducer(fields, {
      type: "toggleCurrentField",
      sourceDetections: SOURCE_DETECTIONS,
    });

    expect(toggled.doc.draft.sources?.["claude-code"]?.enabled).toBe(false);
    expect(toggled.doc.draft.sources?.["claude-code"]?.base_dir).toBeUndefined();
  });

  it("leaves source base dir empty when enabling a source that cannot be detected", () => {
    const doc = updateDraft(
      createDefaultConfigDocument("/tmp/memoark.yaml"),
      "sources.codex.enabled",
      false,
    );
    const initial = createInitialState(doc, SOURCE_DETECTIONS);
    const sources = configCenterReducer(initial, { type: "selectSection", sectionId: "sources" });
    const fields = configCenterReducer(sources, { type: "focusFields" });
    const claudeBaseDir = configCenterReducer(fields, { type: "nextField" });
    const codexEnabled = configCenterReducer(claudeBaseDir, { type: "nextField" });
    const toggled = configCenterReducer(codexEnabled, {
      type: "toggleCurrentField",
      sourceDetections: SOURCE_DETECTIONS,
    });

    expect(toggled.doc.draft.sources?.codex?.enabled).toBe(true);
    expect(toggled.doc.draft.sources?.codex?.base_dir).toBeUndefined();
  });
});

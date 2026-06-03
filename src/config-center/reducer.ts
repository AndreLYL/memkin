import type { DetectedSource } from "../setup/detect-sources.js";
import type { ConfigDocument } from "./document.js";
import { updateDraft } from "./document.js";
import { CONFIG_SECTIONS, type ConfigField, getConfigFieldsForSection } from "./schema.js";
import {
  hydrateSourceBaseDirs,
  sourceIdFromEnabledPath,
  updateSourceEnabled,
} from "./source-dirs.js";

export type ConfigCenterFocus = "fields" | "sections";

export interface ConfigCenterState {
  doc: ConfigDocument;
  sectionId: string;
  sectionIndex: number;
  fieldIndex: number;
  focus: ConfigCenterFocus;
  editing: boolean;
  editValue: string;
  dirty: boolean;
  statusMessage?: string;
}

export type ConfigCenterAction =
  | { type: "selectSection"; sectionId: string }
  | { type: "focusSections" }
  | { type: "focusFields" }
  | { type: "nextSection" }
  | { type: "previousSection" }
  | { type: "nextField" }
  | { type: "previousField" }
  | { type: "startEditing" }
  | { type: "setEditValue"; value: string }
  | { type: "commitEditing"; value?: string }
  | { type: "commitEditingAndMoveField"; direction: "next" | "previous" }
  | { type: "cancelEditing" }
  | { type: "toggleCurrentField"; sourceDetections?: DetectedSource[] }
  | { type: "saveSucceeded" }
  | { type: "setStatus"; message: string };

const EDITABLE_SECTIONS = CONFIG_SECTIONS.map((section) => section.id);

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

function sectionIndex(sectionId: string): number {
  const index = EDITABLE_SECTIONS.indexOf(sectionId);
  return index >= 0 ? index : 0;
}

export function getCurrentFields(state: ConfigCenterState): ConfigField[] {
  return getConfigFieldsForSection(state.sectionId, state.doc.draft);
}

export function getCurrentField(state: ConfigCenterState): ConfigField | undefined {
  return getCurrentFields(state)[state.fieldIndex];
}

function hasConfigurableFields(state: ConfigCenterState): boolean {
  if (state.sectionId === "feishu") return false;
  return getCurrentFields(state).length > 0;
}

function getPathValue(source: unknown, path: string): unknown {
  let cursor = source;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function parseFieldValue(field: ConfigField, value: string): unknown {
  if (field.kind === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function updateFieldFromEdit(state: ConfigCenterState, field: ConfigField): ConfigDocument {
  return updateDraft(state.doc, field.path, parseFieldValue(field, state.editValue));
}

export function createInitialState(
  doc: ConfigDocument,
  sourceDetections: DetectedSource[] = [],
): ConfigCenterState {
  const hydratedDoc = hydrateSourceBaseDirs(doc, sourceDetections);
  return {
    doc: hydratedDoc,
    sectionId: "overview",
    sectionIndex: sectionIndex("overview"),
    fieldIndex: 0,
    focus: "sections",
    editing: false,
    editValue: "",
    dirty: false,
  };
}

export function configCenterReducer(
  state: ConfigCenterState,
  action: ConfigCenterAction,
): ConfigCenterState {
  if (
    state.editing &&
    action.type !== "commitEditing" &&
    action.type !== "commitEditingAndMoveField" &&
    action.type !== "cancelEditing"
  ) {
    if (action.type === "setEditValue") {
      return { ...state, editValue: action.value };
    }
    return state;
  }

  switch (action.type) {
    case "selectSection": {
      return {
        ...state,
        sectionId: action.sectionId,
        sectionIndex: sectionIndex(action.sectionId),
        fieldIndex: 0,
        focus: "sections",
        editing: false,
        editValue: "",
      };
    }
    case "focusSections":
      return { ...state, focus: "sections", editing: false, editValue: "" };
    case "focusFields":
      if (!hasConfigurableFields(state)) return state;
      return { ...state, focus: "fields", fieldIndex: 0, editing: false, editValue: "" };
    case "nextSection": {
      const index = clampIndex(state.sectionIndex + 1, EDITABLE_SECTIONS.length);
      return {
        ...state,
        sectionId: EDITABLE_SECTIONS[index],
        sectionIndex: index,
        fieldIndex: 0,
      };
    }
    case "previousSection": {
      const index = clampIndex(state.sectionIndex - 1, EDITABLE_SECTIONS.length);
      return {
        ...state,
        sectionId: EDITABLE_SECTIONS[index],
        sectionIndex: index,
        fieldIndex: 0,
      };
    }
    case "nextField": {
      if (state.focus !== "fields") return state;
      return {
        ...state,
        fieldIndex: clampIndex(state.fieldIndex + 1, getCurrentFields(state).length),
      };
    }
    case "previousField": {
      if (state.focus !== "fields") return state;
      return {
        ...state,
        fieldIndex: clampIndex(state.fieldIndex - 1, getCurrentFields(state).length),
      };
    }
    case "startEditing": {
      const field = getCurrentField(state);
      if (state.focus !== "fields" || !field || field.kind === "boolean") return state;
      const value = getPathValue(state.doc.draft, field.path);
      return {
        ...state,
        editing: true,
        editValue: value === undefined ? "" : String(value),
      };
    }
    case "commitEditing": {
      const field = getCurrentField(state);
      if (!field) return { ...state, editing: false, editValue: "" };
      const nextDoc = updateDraft(
        state.doc,
        field.path,
        parseFieldValue(field, action.value ?? state.editValue),
      );
      return {
        ...state,
        doc: nextDoc,
        editing: false,
        editValue: "",
        dirty: true,
        statusMessage: `Updated ${field.label}`,
      };
    }
    case "commitEditingAndMoveField": {
      const field = getCurrentField(state);
      if (!field) return { ...state, editing: false, editValue: "" };
      const nextDoc = updateFieldFromEdit(state, field);
      const offset = action.direction === "next" ? 1 : -1;
      const nextFieldCount = getConfigFieldsForSection(state.sectionId, nextDoc.draft).length;
      return {
        ...state,
        doc: nextDoc,
        fieldIndex: clampIndex(state.fieldIndex + offset, nextFieldCount),
        editing: false,
        editValue: "",
        dirty: true,
        statusMessage: `Updated ${field.label}`,
      };
    }
    case "cancelEditing":
      return { ...state, editing: false, editValue: "" };
    case "toggleCurrentField": {
      const field = getCurrentField(state);
      if (state.focus !== "fields" || !field || field.kind !== "boolean") return state;
      const current = getPathValue(state.doc.draft, field.path);
      const nextValue = current !== true;
      const sourceId = sourceIdFromEnabledPath(field.path);
      const nextDoc = sourceId
        ? updateSourceEnabled(state.doc, sourceId, nextValue, action.sourceDetections)
        : updateDraft(state.doc, field.path, nextValue);
      return {
        ...state,
        doc: nextDoc,
        dirty: true,
        statusMessage: `Updated ${field.label}`,
      };
    }
    case "saveSucceeded":
      return { ...state, dirty: false, statusMessage: "Configuration saved" };
    case "setStatus":
      return { ...state, statusMessage: action.message };
    default:
      return state;
  }
}

import { buildConfigObject } from "../../setup/generate-config.js";
import {
  type ConnectionStatusState,
  DEFAULT_CONNECTION_STATUS,
  formatConnectionItem,
} from "../connection-checks.js";
import type { ConfigDocument } from "../document.js";
import { type FieldRecommendation, findRecommendation } from "../recommendations.js";
import type { ConfigCenterFocus } from "../reducer.js";
import { CONFIG_SECTIONS, type ConfigField, getConfigFieldsForSection } from "../schema.js";
import { maskSecret } from "../secrets.js";
import { formatSourceBaseDirValue } from "../source-dirs.js";

export const MEMKIN_SLANT_HEADER = [
  "  ═══════════════════════════════════════════════════════════════════════",
  "      __  ___                                __",
  "     /  |/  /__  ____ ___  ____  ____ ______/ /__",
  "    / /|_/ / _ \\/ __ `__ \\/ __ \\/ __ `/ ___/ //_/",
  "   / /  / /  __/ / / / / / /_/ / /_/ / /  / ,<<",
  "  /_/  /_/\\_\\___/_/ /_/ /_/\\____/\\__,_/_/  /_/|_|",
  "",
  "  ═══════════════════════════════════════════════════════════════════════",
].join("\n");

export const DETAIL_PANE_WIDTH = 78;
export const DETAIL_PANE_HEIGHT = 2;

const DEFAULT_CONFIG = buildConfigObject({});

export interface RenderState {
  sectionId?: string;
  fieldIndex?: number;
  editing?: boolean;
  editValue?: string;
  dirty?: boolean;
  statusMessage?: string;
  recommendations?: FieldRecommendation[];
  focus?: ConfigCenterFocus;
  connectionStatus?: ConnectionStatusState;
}

function getPathValue(source: unknown, path: string): unknown {
  let cursor = source;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function formatDisplayValue(value: unknown, field: ConfigField): string {
  if (field.secret) return maskSecret(typeof value === "string" ? value : undefined);
  if (value === undefined) return "-";
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.join(", ");
  return String(value);
}

function formatValue(doc: ConfigDocument, field: ConfigField): string {
  const sourceBaseDirValue = formatSourceBaseDirValue(doc, field.path);
  if (sourceBaseDirValue !== undefined) return sourceBaseDirValue;
  return formatDisplayValue(getPathValue(doc.draft, field.path), field);
}

function formatDefaultValue(field: ConfigField): string {
  return formatDisplayValue(getPathValue(DEFAULT_CONFIG, field.path), field);
}

function fixedDetailLine(label: string, value: string): string {
  return `${label}: ${value}`.slice(0, DETAIL_PANE_WIDTH).padEnd(DETAIL_PANE_WIDTH);
}

function renderSectionList(sectionId: string): string[] {
  return CONFIG_SECTIONS.map((section) => {
    const marker = section.id === sectionId ? ">" : " ";
    return `${marker} ${section.label.padEnd(20)}`;
  });
}

function renderRecommendationMarker(
  doc: ConfigDocument,
  field: ConfigField,
  recommendations: FieldRecommendation[],
): string {
  if (field.path === "llm.provider" || field.path === "embedding.provider") return "";
  const recommendation = findRecommendation(recommendations, field.path);
  if (!recommendation) return "";

  const current = getPathValue(doc.draft, field.path);
  if (String(current) === recommendation.value) return " [Recommended]";
  return ` [Recommended: ${recommendation.value}]`;
}

function formatFieldLabel(field: ConfigField): string {
  return `${field.label}${field.required ? "*" : ""}`;
}

function renderFieldList(doc: ConfigDocument, state: Required<RenderState>): string[] {
  if (state.sectionId === "feishu") {
    return ["Feishu", "Coming soon — edit memkin.yaml directly."];
  }

  const fields = getConfigFieldsForSection(state.sectionId, doc.draft);
  if (fields.length === 0) {
    return [
      "Overview",
      `Diagnostics: ${doc.diagnostics.length}`,
      `Unknown keys: ${doc.unknownKeys.length}`,
    ];
  }

  return fields.map((field, index) => {
    const marker = index === state.fieldIndex ? ">" : " ";
    const cursor = state.focus === "fields" ? marker : " ";
    const value =
      state.editing && index === state.fieldIndex ? state.editValue : formatValue(doc, field);
    return `${cursor} ${formatFieldLabel(field).padEnd(20)} ${value}${renderRecommendationMarker(
      doc,
      field,
      state.recommendations,
    )}`;
  });
}

function getSelectedField(
  doc: ConfigDocument,
  state: Required<RenderState>,
): ConfigField | undefined {
  const fields = getConfigFieldsForSection(state.sectionId, doc.draft);
  return fields[state.fieldIndex];
}

function renderDescription(field: ConfigField, state: Required<RenderState>): string {
  if (field.path === "embedding.provider") {
    const supported = field.options?.length
      ? `Supported: ${field.options.map((option) => option.value).join(", ")}.`
      : "";
    const recommendation = findRecommendation(state.recommendations, field.path);
    if (recommendation) {
      return `${supported}Recommended: ${recommendation.value}.`;
    }
    return supported || field.description;
  }

  const parts: string[] = [];
  if (field.options?.length) {
    parts.push(`Supported: ${field.options.map((option) => option.value).join(", ")}.`);
  }
  parts.push(field.description);
  return parts.join(" ");
}

function renderDetailPane(doc: ConfigDocument, state: Required<RenderState>): string[] {
  if (state.sectionId === "feishu") {
    return [
      fixedDetailLine("Default", "-"),
      fixedDetailLine(
        "Description",
        "Full Feishu editing is planned for Phase 6. Edit memkin.yaml directly for now.",
      ),
    ];
  }

  const field = getSelectedField(doc, state);
  if (!field) {
    return [
      fixedDetailLine("Default", "-"),
      fixedDetailLine("Description", "No editable field is selected in this section."),
    ];
  }

  return [
    fixedDetailLine("Default", formatDefaultValue(field)),
    fixedDetailLine("Description", renderDescription(field, state)),
  ];
}

function renderConnectionStatus(status: ConnectionStatusState): string {
  return `Connections: LLM ${formatConnectionItem(status.llm)} | Embedding ${formatConnectionItem(
    status.embedding,
  )}`;
}

export function renderConfigCenter(doc: ConfigDocument, renderState: RenderState = {}): string {
  const state: Required<RenderState> = {
    sectionId: renderState.sectionId ?? "llm",
    fieldIndex: renderState.fieldIndex ?? 0,
    editing: renderState.editing ?? false,
    editValue: renderState.editValue ?? "",
    dirty: renderState.dirty ?? false,
    statusMessage: renderState.statusMessage ?? "",
    recommendations: renderState.recommendations ?? [],
    focus: renderState.focus ?? "sections",
    connectionStatus: renderState.connectionStatus ?? DEFAULT_CONNECTION_STATUS,
  };
  const sections = renderSectionList(state.sectionId);
  const fields = renderFieldList(doc, state);
  const details = renderDetailPane(doc, state);
  const rows = Array.from({ length: Math.max(sections.length, fields.length) }, (_, index) => {
    const left = sections[index] ?? " ".repeat(22);
    const right = fields[index] ?? "";
    return `${left} │  ${right}`;
  });

  return `${MEMKIN_SLANT_HEADER}

Memkin Config Center
${doc.path}  ${state.dirty ? "modified" : doc.exists ? "loaded" : "new"}
${renderConnectionStatus(state.connectionStatus)}
--------------------------------------------------------------------------------
${rows.join("\n")}
--------------------------------------------------------------------------------
${details.join("\n")}
--------------------------------------------------------------------------------
Enter edit/toggle  Tab/Up/Down field/section  Left/Right switch bar  Ctrl+S save  Esc/q quit
`;
}

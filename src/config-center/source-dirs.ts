import type { DetectedSource } from "../setup/detect-sources.js";
import type { ConfigDocument } from "./document.js";
import { updateDraft } from "./document.js";

export const SOURCE_BASE_DIR_NOT_FOUND = "读取失败，需要手动配置";

export type ConfigurableSourceId = DetectedSource["id"];

interface SourceFieldPaths {
  enabledPath: string;
  baseDirPath: string;
}

export const SOURCE_FIELD_PATHS: Record<ConfigurableSourceId, SourceFieldPaths> = {
  "claude-code": {
    enabledPath: "sources.claude-code.enabled",
    baseDirPath: "sources.claude-code.base_dir",
  },
  codex: {
    enabledPath: "sources.codex.enabled",
    baseDirPath: "sources.codex.base_dir",
  },
  hermes: {
    enabledPath: "sources.hermes.enabled",
    baseDirPath: "sources.hermes.base_dir",
  },
};

function getPathValue(source: unknown, path: string): unknown {
  let cursor = source;
  for (const part of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function sourceIdFromEnabledPath(path: string): ConfigurableSourceId | undefined {
  return (Object.keys(SOURCE_FIELD_PATHS) as ConfigurableSourceId[]).find(
    (sourceId) => SOURCE_FIELD_PATHS[sourceId].enabledPath === path,
  );
}

export function sourceIdFromBaseDirPath(path: string): ConfigurableSourceId | undefined {
  return (Object.keys(SOURCE_FIELD_PATHS) as ConfigurableSourceId[]).find(
    (sourceId) => SOURCE_FIELD_PATHS[sourceId].baseDirPath === path,
  );
}

function detectedBaseDir(
  sourceId: ConfigurableSourceId,
  detections: DetectedSource[] = [],
): string | undefined {
  const source = detections.find((candidate) => candidate.id === sourceId);
  return source?.detected && source.path ? source.path : undefined;
}

export function hydrateSourceBaseDirs(
  doc: ConfigDocument,
  detections: DetectedSource[] = [],
): ConfigDocument {
  let nextDoc = doc;

  for (const sourceId of Object.keys(SOURCE_FIELD_PATHS) as ConfigurableSourceId[]) {
    const paths = SOURCE_FIELD_PATHS[sourceId];
    const enabled = getPathValue(nextDoc.draft, paths.enabledPath) === true;
    const baseDir = getPathValue(nextDoc.draft, paths.baseDirPath);

    if (!enabled) {
      if (baseDir !== undefined) {
        nextDoc = updateDraft(nextDoc, paths.baseDirPath, undefined);
      }
      continue;
    }

    if (!isNonEmptyString(baseDir)) {
      const detected = detectedBaseDir(sourceId, detections);
      if (detected) {
        nextDoc = updateDraft(nextDoc, paths.baseDirPath, detected);
      }
    }
  }

  return nextDoc;
}

export function updateSourceEnabled(
  doc: ConfigDocument,
  sourceId: ConfigurableSourceId,
  enabled: boolean,
  detections: DetectedSource[] = [],
): ConfigDocument {
  const paths = SOURCE_FIELD_PATHS[sourceId];
  const withEnabled = updateDraft(doc, paths.enabledPath, enabled);

  if (!enabled) {
    return updateDraft(withEnabled, paths.baseDirPath, undefined);
  }

  return updateDraft(withEnabled, paths.baseDirPath, detectedBaseDir(sourceId, detections));
}

export function formatSourceBaseDirValue(doc: ConfigDocument, path: string): string | undefined {
  const sourceId = sourceIdFromBaseDirPath(path);
  if (!sourceId) return undefined;

  const paths = SOURCE_FIELD_PATHS[sourceId];
  const enabled = getPathValue(doc.draft, paths.enabledPath) === true;
  if (!enabled) return "-";

  const baseDir = getPathValue(doc.draft, paths.baseDirPath);
  if (isNonEmptyString(baseDir)) return baseDir;
  return SOURCE_BASE_DIR_NOT_FOUND;
}

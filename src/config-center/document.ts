import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parse, stringify } from "yaml";
import type { Config } from "../core/config.js";
import { buildConfigObject } from "../setup/generate-config.js";
import type { PartialConfig } from "../setup/validate-config.js";
import { type ConfigDiagnostic, validateDraft } from "./validation.js";

export type ConfigDraft = PartialConfig & { adapters?: Config["adapters"] };

export interface ConfigDocument {
  path: string;
  exists: boolean;
  rawYaml: string;
  rawObject: Record<string, unknown>;
  draft: ConfigDraft;
  effective: Config;
  diagnostics: ConfigDiagnostic[];
  unknownKeys: string[];
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "privacy",
  "llm",
  "block_builder",
  "adapters",
  "sources",
  "store",
  "embedding",
  "server",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toDraft(rawObject: Record<string, unknown>): ConfigDraft {
  return buildConfigObject(rawObject as PartialConfig) as ConfigDraft;
}

function buildDocument(
  path: string,
  exists: boolean,
  rawYaml: string,
  rawObject: Record<string, unknown>,
  draft: ConfigDraft,
): ConfigDocument {
  const effective = buildConfigObject(draft);
  return {
    path,
    exists,
    rawYaml,
    rawObject,
    draft,
    effective,
    diagnostics: validateDraft(draft),
    unknownKeys: Object.keys(rawObject).filter((key) => !KNOWN_TOP_LEVEL_KEYS.has(key)),
  };
}

export function createDefaultConfigDocument(path: string): ConfigDocument {
  const rawObject: Record<string, unknown> = {};
  const draft = buildConfigObject({});
  return buildDocument(path, false, "", rawObject, draft);
}

export async function loadConfigDocument(path: string): Promise<ConfigDocument> {
  if (!existsSync(path)) {
    return createDefaultConfigDocument(path);
  }

  const rawYaml = await readFile(path, "utf-8");
  const rawObject = asRecord(parse(rawYaml));
  return buildDocument(path, true, rawYaml, rawObject, toDraft(rawObject));
}

function cloneDraft(draft: ConfigDraft): ConfigDraft {
  return JSON.parse(JSON.stringify(draft)) as ConfigDraft;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

export function updateDraft(doc: ConfigDocument, path: string, value: unknown): ConfigDocument {
  const draft = cloneDraft(doc.draft);
  setPath(draft as Record<string, unknown>, path, value);
  return buildDocument(doc.path, doc.exists, doc.rawYaml, doc.rawObject, draft);
}

function buildSaveObject(doc: ConfigDocument): Record<string, unknown> {
  const built = buildConfigObject(doc.draft) as unknown as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(doc.rawObject)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      result[key] = value;
    }
  }

  for (const key of KNOWN_TOP_LEVEL_KEYS) {
    if (built[key] !== undefined) {
      result[key] = built[key];
    }
  }

  return result;
}

export async function saveConfigDocument(doc: ConfigDocument): Promise<void> {
  await mkdir(dirname(doc.path), { recursive: true });
  const tmpPath = `${doc.path}.tmp`;
  const yaml = stringify(buildSaveObject(doc), { indent: 2 });
  await writeFile(tmpPath, yaml, "utf-8");
  await rename(tmpPath, doc.path);
}

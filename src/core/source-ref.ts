import type { SourceRef } from "./types.js";

function compactValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;

  if (Array.isArray(value)) {
    const compacted = value.map((item) => compactValue(item)).filter((item) => item !== undefined);
    return compacted.length > 0 ? compacted : undefined;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, compactValue(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);

    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }

  return value;
}

export function compactSourceRef(source: SourceRef): SourceRef {
  return compactValue(source) as SourceRef;
}

export function compactRecord<T extends Record<string, unknown>>(record: T): T {
  return (compactValue(record) ?? {}) as T;
}

/**
 * CursorStore — Collector cursor persistence
 * Stores continuation tokens for incremental collection
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

export class CursorStore {
  private cursors: Map<string, string>; // collectorId → cursor value
  private dirty: boolean = false;

  constructor(private cursorPath: string) {
    this.cursors = new Map();
  }

  /**
   * Load cursors from YAML file (key: value pairs)
   */
  load(): void {
    if (!existsSync(this.cursorPath)) {
      return;
    }

    try {
      const content = readFileSync(this.cursorPath, "utf-8");
      const data = parse(content) as Record<string, string> | null;

      if (data && typeof data === "object") {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "string") {
            this.cursors.set(key, value);
          }
        }
      }
    } catch {
      // Skip malformed or empty YAML files
    }
  }

  /**
   * Get cursor for a collector
   */
  get(collectorId: string): string | undefined {
    return this.cursors.get(collectorId);
  }

  /**
   * Set cursor in memory only, mark dirty
   */
  set(collectorId: string, cursor: string): void {
    this.cursors.set(collectorId, cursor);
    this.dirty = true;
  }

  /**
   * Store a structured cursor as JSON string
   */
  setJSON(collectorId: string, data: Record<string, unknown>): void {
    this.set(collectorId, JSON.stringify(data));
  }

  /**
   * Retrieve a structured cursor, returns undefined if missing or not valid JSON
   */
  getJSON<T = Record<string, unknown>>(collectorId: string): T | undefined {
    const raw = this.get(collectorId);
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) return parsed as T;
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Write all cursors to YAML file (only if dirty)
   * Only called by pipeline when failedBlocks === 0
   */
  commit(): void {
    if (!this.dirty) {
      return;
    }

    const data: Record<string, string> = {};
    for (const [key, value] of this.cursors.entries()) {
      data[key] = value;
    }

    const yaml = stringify(data);
    writeFileSync(this.cursorPath, yaml, "utf-8");
    this.dirty = false;
  }
}

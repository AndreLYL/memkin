type CursorValue = Record<string, unknown>;

interface StagedEntry {
  cursor: CursorValue;
  committed: boolean;
}

export class CursorStaging {
  private entries = new Map<string, Map<string, StagedEntry>>();

  stage(source: string, key: string, cursor: CursorValue): void {
    let sourceMap = this.entries.get(source);
    if (!sourceMap) {
      sourceMap = new Map();
      this.entries.set(source, sourceMap);
    }
    sourceMap.set(key, { cursor, committed: false });
  }

  commit(source: string, key: string): void {
    const entry = this.entries.get(source)?.get(key);
    if (entry) {
      entry.committed = true;
    }
  }

  discard(source: string, key: string): void {
    this.entries.get(source)?.delete(key);
  }

  discardSource(source: string): void {
    this.entries.delete(source);
  }

  getCommittable(): Record<string, Record<string, CursorValue>> {
    const result: Record<string, Record<string, CursorValue>> = {};
    for (const [source, sourceMap] of this.entries) {
      for (const [key, entry] of sourceMap) {
        if (entry.committed) {
          if (!result[source]) result[source] = {};
          result[source][key] = entry.cursor;
        }
      }
    }
    return result;
  }
}

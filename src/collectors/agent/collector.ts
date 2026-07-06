// src/collectors/agent/collector.ts
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import fg from "fast-glob";
import type { Collector, FetchOpts, RawMessage } from "../../core/types.js";
import type { SessionLayout, SessionMeta, SessionParseContext, SessionParser } from "./types.js";

/** A consistent point-in-time read of a transcript file, plus its revision fingerprint. */
export interface StableSnapshot {
  content: string;
  /** sha256 of the raw file content — the revision key (see agent_sessions / M007). */
  contentHash: string;
  byteSize: number;
  /** Total lines via split("\n") — aligns with programmatic msg_id assignment (spec §5.2). */
  lineCount: number;
}

/** Minimal fs surface used by readStableSnapshot — injectable for deterministic tests. */
export interface SnapshotFs {
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  readFile(path: string, enc: "utf-8"): Promise<string>;
}

const defaultSnapshotFs: SnapshotFs = {
  stat: (p) => fs.stat(p),
  readFile: (p, enc) => fs.readFile(p, enc),
};

/**
 * Read a transcript file only if it is stable across the read.
 *
 * A transcript being actively written (an agent still in-session) can be mutated mid-read,
 * yielding a torn snapshot. To avoid ingesting a half-written revision we stat before and
 * after reading; if size or mtime differ, the file changed under us — return null and let
 * the caller retry on a later tick (the scan watermark still advances independently).
 *
 * `deps` is injectable so tests can simulate a write-in-progress without touching the real
 * filesystem (node:fs/promises exports are non-configurable and cannot be spied directly).
 */
export async function readStableSnapshot(
  filePath: string,
  deps: SnapshotFs = defaultSnapshotFs,
): Promise<StableSnapshot | null> {
  try {
    const before = await deps.stat(filePath);
    const content = await deps.readFile(filePath, "utf-8");
    const after = await deps.stat(filePath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      return null;
    }
    return {
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      byteSize: Buffer.byteLength(content, "utf-8"),
      lineCount: content.split("\n").length,
    };
  } catch {
    return null;
  }
}

export class AgentSessionCollector implements Collector {
  readonly id: string;
  readonly name: string;
  readonly description: string;

  constructor(
    private readonly layout: SessionLayout,
    private readonly parser: SessionParser,
    opts?: { name?: string; description?: string },
  ) {
    this.id = parser.platformId;
    this.name = opts?.name ?? `${parser.platformId} collector`;
    this.description = opts?.description ?? `Collects from ${parser.platformId}`;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      await fs.access(this.layout.baseDir);
      return { ok: true, message: `Directory exists: ${this.layout.baseDir}` };
    } catch {
      return { ok: false, message: `Directory not found: ${this.layout.baseDir}` };
    }
  }

  async *fetch(_opts: FetchOpts): AsyncGenerator<RawMessage> {
    const processedSessions = new Set<string>();

    const files = await this.discoverFiles();
    if (files.length === 0) return;

    // Sort by mtime (oldest first)
    const filesWithMtime = await Promise.all(
      files.map(async (f) => {
        try {
          const stat = await fs.stat(f);
          return { path: f, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      }),
    );
    const sorted = filesWithMtime
      .filter((f): f is { path: string; mtime: number } => f !== null)
      .sort((a, b) => a.mtime - b.mtime);

    for (const file of sorted) {
      const sessionIdFromPath = this.layout.sessionIdFromPath(file.path);
      const channel = this.layout.channelFromPath(file.path, sessionIdFromPath);

      let sessionMeta: SessionMeta | null = null;
      let currentSessionId = sessionIdFromPath;

      // Stable snapshot read: skip files that are being written under us this tick.
      const snapshot = await readStableSnapshot(file.path);
      if (!snapshot) continue;
      const lines = snapshot.content.split("\n");

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex].trim();
        if (!line) continue;

        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }

        const meta = this.parser.parseSessionMeta(parsed);
        if (meta) {
          sessionMeta = meta;
          currentSessionId = meta.sessionId;
          continue;
        }

        if (processedSessions.has(currentSessionId)) {
          continue;
        }

        if (!this.parser.isConversationRecord(parsed)) {
          continue;
        }

        const context: SessionParseContext = {
          sessionId: currentSessionId,
          filePath: file.path,
          channel,
          lineIndex,
          sessionMeta,
        };

        const message = this.parser.parseRecord(parsed, context);
        if (message) {
          message.metadata = {
            ...message.metadata,
            line_index: lineIndex,
            file_path: file.path,
          };
          yield message;
        }
      }

      processedSessions.add(currentSessionId);
    }
  }

  private async discoverFiles(): Promise<string[]> {
    try {
      return await fg(this.layout.glob, {
        cwd: this.layout.baseDir,
        absolute: true,
        onlyFiles: true,
      });
    } catch {
      // baseDir doesn't exist or not readable
      return [];
    }
  }
}

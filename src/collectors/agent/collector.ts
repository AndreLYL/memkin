// src/collectors/agent/collector.ts
import * as fs from "node:fs/promises";
import fg from "fast-glob";
import type { Collector, FetchOpts, RawMessage } from "../../core/types.js";
import type { SessionLayout, SessionMeta, SessionParseContext, SessionParser } from "./types.js";

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

      const content = await fs.readFile(file.path, "utf-8");
      const lines = content.split("\n");

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

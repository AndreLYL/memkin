import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Collector, FetchOpts, RawMessage } from '../../core/types';

interface ClaudeCodeRecord {
  type: string;
  message?: {
    role: 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  };
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  [key: string]: unknown;
}

export class ClaudeCodeCollector implements Collector {
  readonly id = 'claude-code';
  readonly name = 'Claude Code Agent';
  readonly description = 'Collects conversation history from Claude Code JSONL transcripts';

  constructor(private readonly projectsDir?: string) {
    this.projectsDir = projectsDir || path.join(os.homedir(), '.claude', 'projects');
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      await fs.access(this.projectsDir!);
      return {
        ok: true,
        message: `Claude Code projects directory exists at ${this.projectsDir}`,
      };
    } catch {
      return {
        ok: false,
        message: `Claude Code projects directory not found at ${this.projectsDir}`,
      };
    }
  }

  async *fetch(opts: FetchOpts): AsyncGenerator<RawMessage> {
    const cursor = opts.cursor;
    const processedSessions = new Set<string>();

    // Find all JSONL files in all project directories
    const projectDirs = await this.scanProjectDirectories();

    for (const projectDir of projectDirs) {
      const jsonlFiles = await this.findJsonlFiles(projectDir);

      for (const file of jsonlFiles) {
        // Parse each JSONL file
        const records = await this.parseJsonlFile(file);

        // Group by session
        const sessionGroups = this.groupBySession(records);

        for (const [sessionId, sessionRecords] of sessionGroups) {
          // Skip if before cursor
          if (cursor && sessionId <= cursor) {
            continue;
          }

          // Skip if already processed in this run
          if (processedSessions.has(sessionId)) {
            continue;
          }

          processedSessions.add(sessionId);

          // Extract messages from this session
          for (const record of sessionRecords) {
            if (record.type === 'user' || record.type === 'assistant') {
              const message = this.recordToRawMessage(record, sessionId);
              if (message) {
                yield message;
              }
            }
          }
        }
      }
    }
  }

  private async scanProjectDirectories(): Promise<string[]> {
    const dirs: string[] = [];

    try {
      const entries = await fs.readdir(this.projectsDir!, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          dirs.push(path.join(this.projectsDir!, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return dirs;
  }

  private async findJsonlFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          files.push(path.join(dir, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    // Sort by modification time (newest first) for faster cursor-based skipping
    const stats = await Promise.all(
      files.map(async (f) => ({ path: f, mtime: (await fs.stat(f)).mtimeMs }))
    );
    stats.sort((a, b) => a.mtime - b.mtime);
    return stats.map((s) => s.path);
  }

  private async parseJsonlFile(filePath: string): Promise<ClaudeCodeRecord[]> {
    const records: ClaudeCodeRecord[] = [];

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as ClaudeCodeRecord;
          records.push(record);
        } catch {
          // Skip malformed lines
        }
      }
    } catch {
      // File read error, skip this file
    }

    return records;
  }

  private groupBySession(
    records: ClaudeCodeRecord[]
  ): Map<string, ClaudeCodeRecord[]> {
    const groups = new Map<string, ClaudeCodeRecord[]>();

    for (const record of records) {
      const sessionId = record.sessionId;
      if (!sessionId) continue;

      if (!groups.has(sessionId)) {
        groups.set(sessionId, []);
      }
      groups.get(sessionId)!.push(record);
    }

    return groups;
  }

  private recordToRawMessage(
    record: ClaudeCodeRecord,
    sessionId: string
  ): RawMessage | null {
    if (!record.message || !record.timestamp || !record.uuid) {
      return null;
    }

    const { role, content } = record.message;

    // Extract text content
    let textContent: string;
    if (typeof content === 'string') {
      textContent = content;
    } else if (Array.isArray(content)) {
      // Handle array content (e.g., tool_use, thinking blocks)
      textContent = JSON.stringify(content, null, 2);
    } else {
      return null;
    }

    return {
      platform: 'claude-code',
      channel: sessionId,
      contact: role === 'user' ? 'user' : 'assistant',
      timestamp: record.timestamp,
      content: textContent,
      direction: role === 'user' ? 'sent' : 'received',
      metadata: {
        session_id: sessionId,
        uuid: record.uuid,
        cursor: sessionId,
        cwd: record.cwd,
      },
    };
  }
}

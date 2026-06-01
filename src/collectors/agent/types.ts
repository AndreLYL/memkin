/**
 * Shared interfaces for the collector/agent subsystem.
 * Defines how platform-specific parsers communicate with AgentSessionCollector.
 */

import type { RawMessage } from "../../core/types.js";

/**
 * Metadata extracted from a session (first line or header of a session file).
 * Common across all platforms but with optional platform-specific fields.
 */
export interface SessionMeta {
  sessionId: string;
  timestamp: string; // ISO 8601
  cwd?: string;
}

/**
 * Context passed to a parser during line-by-line processing.
 * Accumulates as the file is parsed, allowing parsers to reference prior state.
 */
export interface SessionParseContext {
  sessionId: string;
  filePath: string;
  channel: string;
  lineIndex: number;
  sessionMeta: SessionMeta | null;
}

/**
 * Platform-specific parser for converting raw session logs into RawMessages.
 * Implemented by each platform (claude-code, codex, hermes, etc.).
 */
export interface SessionParser {
  readonly platformId: string;

  /**
   * Extract session metadata from the first line (or header block).
   * Returns null if the line is not a valid session meta.
   */
  parseSessionMeta(line: Record<string, unknown>): SessionMeta | null;

  /**
   * Determine if a line is a conversation record (vs. metadata, status, etc.).
   */
  isConversationRecord(line: Record<string, unknown>): boolean;

  /**
   * Convert a conversation record line into a RawMessage.
   * Returns null if parsing fails or the line should be skipped.
   */
  parseRecord(line: Record<string, unknown>, context: SessionParseContext): RawMessage | null;
}

/**
 * Defines the file layout for a platform's session logs.
 * Used by AgentSessionCollector to locate and identify sessions.
 */
export interface SessionLayout {
  /** Base directory where session files are stored. */
  baseDir: string;

  /** Glob pattern to match session files (e.g. "**\/*.jsonl"). */
  glob: string;

  /** Extract sessionId from a file path. */
  sessionIdFromPath: (filePath: string) => string;

  /** Extract channel name from a file path, given the sessionId. */
  channelFromPath: (filePath: string, sessionId: string) => string;
}

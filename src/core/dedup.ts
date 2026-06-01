/**
 * DedupStore — Message deduplication tracking
 * Checkpoints source identity and content hashes to detect new/modified/unchanged messages
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { DedupEntry, RawMessage } from "./types.js";

export class DedupStore {
  private entries: Map<string, string>; // source_hash → content_hash

  constructor(private checkpointPath: string) {
    this.entries = new Map();
  }

  /**
   * Load existing entries from checkpointPath (JSONL format)
   * Each line: {"source_hash":"...","content_hash":"..."}
   */
  load(): void {
    if (!existsSync(this.checkpointPath)) {
      return;
    }

    const content = readFileSync(this.checkpointPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as DedupEntry;
        this.entries.set(entry.source_hash, entry.content_hash);
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Generate source identity hash for a message
   * SHA-256(platform:channel:identityKey:timestamp)
   *
   * Identity key priority:
   * 1. metadata.message_id
   * 2. metadata.uuid
   * 3. metadata.thread_id
   * 4. metadata.session_id ? `${session_id}:${index ?? 0}` : undefined
   * 5. `${timestamp}:${index ?? 0}` (fallback)
   */
  sourceIdentityHash(msg: RawMessage): string {
    const metadata = msg.metadata || {};

    let identityKey: string;

    if (metadata.message_id) {
      identityKey = String(metadata.message_id);
    } else if (metadata.uuid) {
      identityKey = String(metadata.uuid);
    } else if (metadata.thread_id) {
      identityKey = String(metadata.thread_id);
    } else if (metadata.session_id) {
      const index = metadata.index ?? 0;
      identityKey = `${metadata.session_id}:${index}`;
    } else {
      const index = metadata.index ?? 0;
      identityKey = `${msg.timestamp}:${index}`;
    }

    const composite = `${msg.platform}:${msg.channel}:${identityKey}:${msg.timestamp}`;
    return createHash("sha256").update(composite).digest("hex");
  }

  /**
   * Generate content hash for a message
   * SHA-256(content:attachment_ids_joined_by_comma)
   */
  contentHash(msg: RawMessage): string {
    const attachmentIds = msg.attachments?.map((a) => a.id).join(",") || "";
    const composite = `${msg.content}:${attachmentIds}`;
    return createHash("sha256").update(composite).digest("hex");
  }

  /**
   * Check message status
   * - new: source_hash not in entries
   * - unchanged: source_hash exists AND content_hash matches
   * - modified: source_hash exists AND content_hash differs
   */
  check(msg: RawMessage): "new" | "unchanged" | "modified" {
    const sourceHash = this.sourceIdentityHash(msg);
    const existingContentHash = this.entries.get(sourceHash);

    if (!existingContentHash) {
      return "new";
    }

    const currentContentHash = this.contentHash(msg);
    return currentContentHash === existingContentHash ? "unchanged" : "modified";
  }

  /**
   * Commit messages to checkpoint file (append JSONL)
   * Only called by pipeline on success — NEVER in finally block
   */
  commit(msgs: RawMessage[]): void {
    if (msgs.length === 0) {
      return;
    }

    const lines = msgs.map((msg) => {
      const sourceHash = this.sourceIdentityHash(msg);
      const contentHash = this.contentHash(msg);
      const entry: DedupEntry = { source_hash: sourceHash, content_hash: contentHash };

      // Update in-memory map
      this.entries.set(sourceHash, contentHash);

      return JSON.stringify(entry);
    });

    appendFileSync(this.checkpointPath, `${lines.join("\n")}\n`, "utf-8");
  }
}

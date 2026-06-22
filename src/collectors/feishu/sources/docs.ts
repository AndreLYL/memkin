import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { FeishuHttpClient } from "../http-client.js";
import type { FeishuDocSourceConfig, FeishuDriveFile, SourceCheckpoint } from "../types.js";
import type { FeishuSource } from "./base.js";

export class DocSource implements FeishuSource {
  readonly name = "docs";
  private readonly deepFolders: Set<string>;

  constructor(
    private readonly client: FeishuHttpClient,
    private readonly config: FeishuDocSourceConfig,
  ) {
    this.deepFolders = new Set(config.doc_deep_extract_folders ?? []);
  }

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    for (const folderToken of this.config.doc_folders) {
      try {
        yield* this.fetchFolder(folderToken, checkpoint, cursorStaging);
      } catch (error) {
        console.error(`[DocSource] Failed to fetch folder ${folderToken}:`, error);
      }
    }
  }

  private async *fetchFolder(
    folderToken: string,
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    const folderCp = checkpoint?.[folderToken] as { last_edit_time?: number } | undefined;
    const lastEditTime = folderCp?.last_edit_time ?? 0;
    let maxModifiedTime = 0;
    const isDeepFolder = this.deepFolders.has(folderToken);

    for await (const page of this.client.paginate<FeishuDriveFile>("/open-apis/drive/v1/files", {
      folder_token: folderToken,
      page_size: "50",
    })) {
      for (const file of page.items) {
        const modifiedTimeMs = Number.parseInt(file.modified_time, 10) * 1000;

        if (modifiedTimeMs <= lastEditTime) {
          continue;
        }

        if (modifiedTimeMs > maxModifiedTime) {
          maxModifiedTime = modifiedTimeMs;
        }

        if (isDeepFolder && file.type === "docx") {
          yield* this.fetchDeepDoc(file, folderToken);
        } else {
          yield this.mapFileSummary(file, folderToken);
        }
      }
    }

    const cursorTime = maxModifiedTime > 0 ? maxModifiedTime : lastEditTime;
    if (cursorTime > 0) {
      // Stage only — the pipeline commits this cursor after confirming ingestion.
      cursorStaging.stage(this.name, folderToken, { last_edit_time: cursorTime });
    }
  }

  private mapFileSummary(file: FeishuDriveFile, folderToken: string): RawMessage {
    const content = file.name;
    const collaborators = file.edit_users?.map((u) => u.open_id) ?? [];

    return {
      platform: "feishu",
      channel: `docs/${folderToken}`,
      contact: file.owner_id,
      timestamp: new Date(Number.parseInt(file.modified_time, 10) * 1000).toISOString(),
      content,
      direction: "received",
      metadata: {
        doc_token: file.token,
        doc_type: file.type,
        doc_url: file.url,
        collaborators,
        created_time: Number.parseInt(file.created_time, 10) * 1000,
        modified_time: Number.parseInt(file.modified_time, 10) * 1000,
        extract_mode: "summary",
      },
    };
  }

  private async *fetchDeepDoc(
    file: FeishuDriveFile,
    folderToken: string,
  ): AsyncGenerator<RawMessage> {
    try {
      const res = await this.client.request<{ code: number; data: { content: string } }>(
        "GET",
        `/open-apis/docx/v1/documents/${file.token}/raw_content`,
      );

      const rawContent = res.data.content;
      const chunks = this.chunkByHeading(rawContent);

      for (let i = 0; i < chunks.length; i++) {
        yield {
          platform: "feishu",
          channel: `docs/${folderToken}`,
          contact: file.owner_id,
          timestamp: new Date(Number.parseInt(file.modified_time, 10) * 1000).toISOString(),
          content: chunks[i].content,
          direction: "received",
          metadata: {
            doc_token: file.token,
            doc_url: file.url,
            section_title: chunks[i].title,
            chunk_index: i,
            total_chunks: chunks.length,
            extract_mode: "deep",
          },
        };
      }
    } catch (error) {
      console.error(
        `[DocSource] Deep extract failed for ${file.token}, falling back to summary:`,
        error,
      );
      yield this.mapFileSummary(file, folderToken);
    }
  }

  chunkByHeading(content: string): Array<{ title: string | null; content: string }> {
    const headingRegex = /^(#{1,2})\s+(.+)$/gm;
    const chunks: Array<{ title: string | null; content: string }> = [];
    let lastIndex = 0;
    let lastTitle: string | null = null;
    let match: RegExpExecArray | null;

    match = headingRegex.exec(content);
    while (match !== null) {
      if (match.index > lastIndex) {
        const text = content.slice(lastIndex, match.index).trim();
        if (text.length > 0) {
          chunks.push(...this.splitLongChunk(lastTitle, text));
        }
      }
      lastTitle = match[2];
      lastIndex = match.index + match[0].length;
      match = headingRegex.exec(content);
    }

    const remaining = content.slice(lastIndex).trim();
    if (remaining.length > 0) {
      chunks.push(...this.splitLongChunk(lastTitle, remaining));
    }

    if (chunks.length === 0 && content.trim().length > 0) {
      chunks.push({ title: null, content: content.trim() });
    }

    return chunks;
  }

  private splitLongChunk(
    title: string | null,
    text: string,
    maxChars: number = 4000,
  ): Array<{ title: string | null; content: string }> {
    if (text.length <= maxChars) {
      return [{ title, content: text }];
    }

    const paragraphs = text.split(/\n\n+/);
    const result: Array<{ title: string | null; content: string }> = [];
    let current = "";

    for (const para of paragraphs) {
      if (current.length + para.length + 2 > maxChars && current.length > 0) {
        result.push({ title, content: current.trim() });
        current = para;
      } else {
        current += (current ? "\n\n" : "") + para;
      }
    }

    if (current.trim().length > 0) {
      result.push({ title, content: current.trim() });
    }

    return result;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter, AdapterPushResult, ExtractionResult } from '../core/types.js';
import { JSONFormatter } from '../formatters/json.js';
import { MarkdownFormatter } from '../formatters/markdown.js';

export interface FileAdapterConfig {
  output_dir: string;
  format: 'json' | 'markdown';
}

export class FileAdapter implements Adapter {
  id = 'file';
  name = 'File Adapter';
  description = 'Writes extraction results to files';

  private config: FileAdapterConfig;
  private formatter: JSONFormatter | MarkdownFormatter;

  constructor(config: FileAdapterConfig) {
    this.config = config;
    this.formatter = config.format === 'json' ? new JSONFormatter() : new MarkdownFormatter();
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    try {
      // Create output_dir if it doesn't exist
      if (!existsSync(this.config.output_dir)) {
        await mkdir(this.config.output_dir, { recursive: true });
      }

      return { ok: true, message: 'File adapter is ready' };
    } catch (error) {
      return {
        ok: false,
        message: `Failed to initialize output directory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async push(results: ExtractionResult[]): Promise<AdapterPushResult> {
    const pushResult: AdapterPushResult = {
      written: 0,
      skipped: 0,
      errors: [],
    };

    for (const result of results) {
      try {
        const content = this.formatter.format(result);
        const timestamp = Date.now();
        const extension = this.config.format === 'json' ? 'json' : 'md';
        const filename = `${result.source.platform}-${result.source.channel}-${timestamp}.${extension}`;
        const filepath = join(this.config.output_dir, filename);

        await writeFile(filepath, content, 'utf-8');
        pushResult.written += 1;
      } catch (error) {
        pushResult.errors.push({
          signal: `${result.source.platform}/${result.source.channel}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return pushResult;
  }
}

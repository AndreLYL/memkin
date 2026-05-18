import type { Adapter, AdapterPushResult, ExtractionResult } from '../core/types.js';

export class StdoutAdapter implements Adapter {
  id = 'stdout';
  name = 'Stdout Adapter';
  description = 'Outputs extraction results to stdout as JSON';

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: 'Stdout adapter is always ready' };
  }

  async push(results: ExtractionResult[]): Promise<AdapterPushResult> {
    const pushResult: AdapterPushResult = {
      written: 0,
      skipped: 0,
      errors: [],
    };

    for (const result of results) {
      try {
        console.log(JSON.stringify(result, null, 2));
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

/**
 * Pipeline Orchestration
 * Chains all components for complete data flow:
 * Collector → Dedup → BlockBuilder → NoiseFilter → Extractor → Privacy → Formatter → Adapter
 */

import type {
  Collector,
  RawMessage,
  ConversationBlock,
  BlockResult,
  ExtractionResult,
  Formatter,
  Adapter,
} from './types.js';
import type { LLMProvider } from '../extractors/providers/types.js';
import { DedupStore } from './dedup.js';
import { CursorStore } from './cursors.js';
import { BlockBuilder } from './block-builder.js';
import { filterNoise, NoiseFilterVerdict } from '../extractors/noise-filter.js';
import { createSignalExtractor } from '../extractors/signal-extractor.js';
import { PrivacyProcessor } from '../processors/privacy.js';
import { JSONFormatter } from '../formatters/json.js';
import { MarkdownFormatter } from '../formatters/markdown.js';
import { FileAdapter } from '../adapters/file.js';
import { GBrainAdapter } from '../adapters/gbrain.js';
import { StdoutAdapter } from '../adapters/stdout.js';
import type { PrivacyConfig } from './config.js';

/**
 * Pipeline configuration
 */
export interface PipelineConfig {
  dedup_checkpoint: string;
  cursor_checkpoint: string;
  block_gap_minutes: number;
  max_block_tokens: number;
  max_block_messages: number;
  privacy: PrivacyConfig;
  output_dir: string;
}

/**
 * Pipeline execution options
 */
export interface PipelineOpts {
  source: Collector;
  provider?: LLMProvider;
  format: 'json' | 'markdown';
  adapter: 'file' | 'gbrain' | 'stdout';
  dryRun?: boolean;
  since?: string;
  limit?: number;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  fatal: boolean;
  error?: string;
  totalMessages: number;
  totalBlocks: number;
  okBlocks: number;
  skippedBlocks: number;
  failedBlocks: number;
  okMessages: RawMessage[];
  skippedMessages: RawMessage[];
  failedMessages: RawMessage[];
  lastSuccessMessage?: RawMessage;
  warnings: string[];
}

/**
 * Run the complete extraction pipeline
 *
 * @param config - Pipeline configuration
 * @param opts - Execution options
 * @returns Pipeline result
 */
export async function runPipeline(
  config: PipelineConfig,
  opts: PipelineOpts
): Promise<PipelineResult> {
  const result: PipelineResult = {
    fatal: false,
    totalMessages: 0,
    totalBlocks: 0,
    okBlocks: 0,
    skippedBlocks: 0,
    failedBlocks: 0,
    okMessages: [],
    skippedMessages: [],
    failedMessages: [],
    warnings: [],
  };

  try {
    // Initialize stores
    const dedupStore = new DedupStore(config.dedup_checkpoint);
    const cursorStore = new CursorStore(config.cursor_checkpoint);

    dedupStore.load();
    cursorStore.load();

    // Get cursor for this collector
    const cursor = cursorStore.get(opts.source.id);

    // Stage 1: Collector.fetch + Dedup.check
    const newOrModifiedMessages: RawMessage[] = [];

    try {
      for await (const msg of opts.source.fetch({ cursor, limit: opts.limit })) {
        result.totalMessages++;

        // Apply since filter
        if (opts.since) {
          const msgTime = new Date(msg.timestamp);
          const sinceTime = new Date(opts.since);
          if (msgTime < sinceTime) {
            continue;
          }
        }

        // Dedup check
        const dedupStatus = dedupStore.check(msg);

        if (dedupStatus === 'unchanged') {
          result.skippedMessages.push(msg);
          continue;
        }

        // new or modified - process it
        newOrModifiedMessages.push(msg);
      }
    } catch (err) {
      // Fatal error in collector
      result.fatal = true;
      result.error = `Fatal collector error: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }

    // Stage 2: BlockBuilder
    const blockBuilder = new BlockBuilder({
      block_gap_minutes: config.block_gap_minutes,
      max_block_tokens: config.max_block_tokens,
      max_block_messages: config.max_block_messages,
    });

    const blocks: ConversationBlock[] = [];

    try {
      for await (const block of blockBuilder.build(
        (async function* () {
          for (const msg of newOrModifiedMessages) {
            yield msg;
          }
        })()
      )) {
        blocks.push(block);
        result.totalBlocks++;
      }
    } catch (err) {
      result.fatal = true;
      result.error = `Fatal block builder error: ${err instanceof Error ? err.message : String(err)}`;
      return result;
    }

    // Dry-run stops here
    if (opts.dryRun) {
      return result;
    }

    // Stage 3: NoiseFilter + Extractor + Privacy + Formatter + Adapter
    if (!opts.provider) {
      result.fatal = true;
      result.error = 'LLM provider is required for non-dry-run execution';
      return result;
    }

    const extractor = createSignalExtractor(opts.provider);
    const privacyProcessor = new PrivacyProcessor(config.privacy);
    const formatter = opts.format === 'json' ? new JSONFormatter() : new MarkdownFormatter();

    let adapter: Adapter;
    if (opts.adapter === 'file') {
      adapter = new FileAdapter({
        output_dir: config.output_dir,
        format: opts.format,
      });
    } else if (opts.adapter === 'gbrain') {
      adapter = new GBrainAdapter();
    } else {
      adapter = new StdoutAdapter();
    }

    // Check adapter health
    const adapterHealth = await adapter.healthCheck();
    if (!adapterHealth.ok) {
      result.fatal = true;
      result.error = `Adapter health check failed: ${adapterHealth.message}`;
      return result;
    }

    // Process each block
    const extractedResults: ExtractionResult[] = [];

    for (const block of blocks) {
      try {
        // Noise filter
        const filterVerdict: NoiseFilterVerdict = await filterNoise(block, opts.provider);

        if (filterVerdict === 'skip') {
          result.skippedBlocks++;
          result.skippedMessages.push(...block.messages);
          continue;
        }

        // Extract signals
        const blockResult: BlockResult = await extractor.extract(block);

        if (blockResult.status === 'failed') {
          result.failedBlocks++;
          result.failedMessages.push(...block.messages);
          result.warnings.push(
            `Block ${block.block_id} extraction failed: ${blockResult.error}`
          );
          continue;
        }

        if (blockResult.status === 'skipped') {
          result.skippedBlocks++;
          result.skippedMessages.push(...block.messages);
          continue;
        }

        // Success - process extraction result
        result.okBlocks++;
        result.okMessages.push(...block.messages);

        // Apply privacy processing
        const processedResult = privacyProcessor.process(blockResult.data);
        extractedResults.push(processedResult);

        // Track last successful message
        result.lastSuccessMessage = block.messages[block.messages.length - 1];
      } catch (err) {
        // Non-fatal error - log and continue
        result.failedBlocks++;
        result.failedMessages.push(...block.messages);
        result.warnings.push(
          `Block ${block.block_id} processing error: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Stage 4: Adapter.push (all results in one batch)
    if (extractedResults.length > 0) {
      try {
        const pushResult = await adapter.push(extractedResults);

        // Log adapter errors as warnings
        for (const error of pushResult.errors) {
          result.warnings.push(`Adapter error for ${error.signal}: ${error.reason}`);
        }
      } catch (err) {
        result.fatal = true;
        result.error = `Fatal adapter error: ${err instanceof Error ? err.message : String(err)}`;
        return result;
      }
    }

    // Stage 5: Commit (only if no failed blocks)
    if (result.failedBlocks === 0) {
      // Commit dedup entries for ok + skipped messages
      const messagesToCommit = [...result.okMessages, ...result.skippedMessages];
      dedupStore.commit(messagesToCommit);

      // Commit cursor if we have a last successful message
      if (result.lastSuccessMessage?.metadata?.cursor) {
        cursorStore.set(
          opts.source.id,
          String(result.lastSuccessMessage.metadata.cursor)
        );
        cursorStore.commit();
      }
    }

    return result;
  } catch (err) {
    // Catch-all for unexpected errors
    result.fatal = true;
    result.error = `Unexpected pipeline error: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }
}

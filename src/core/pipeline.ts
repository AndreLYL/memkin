/**
 * Pipeline Orchestration
 * Chains all components for complete data flow:
 * Collector → Dedup → BlockBuilder → NoiseFilter → Extractor → Privacy → Formatter → Adapter
 */

import { FileAdapter } from "../adapters/file.js";
import { GBrainAdapter } from "../adapters/gbrain.js";
import { StdoutAdapter } from "../adapters/stdout.js";
import { StoreAdapter, type StoreAdapterContext } from "../adapters/store.js";
import {
  filterNoiseL1,
  mapScoreDecision,
  type NoiseFilterVerdict,
} from "../extractors/noise-filter.js";
import type { LLMProvider } from "../extractors/providers/types.js";
import { createSignalExtractor } from "../extractors/signal-extractor.js";
import { PrivacyProcessor } from "../processors/privacy.js";
import { BlockBuilder } from "./block-builder.js";
import { canonicalize } from "./canonicalize.js";
import type { PrivacyConfig } from "./config.js";
import { CursorStore } from "./cursors.js";
import { DedupStore } from "./dedup.js";
import { scoreBlock } from "./signal-scoring.js";
import type {
  Adapter,
  BlockResult,
  Collector,
  ConversationBlock,
  ExtractionResult,
  RawMessage,
} from "./types.js";

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
  block_concurrency?: number;
}

/**
 * Pipeline execution options
 */
export interface PipelineOpts {
  source: Collector;
  provider?: LLMProvider;
  format: "json" | "markdown";
  adapter: "store" | "file" | "gbrain" | "stdout";
  stores?: StoreAdapterContext;
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
  opts: PipelineOpts,
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
      let accepted = 0;
      for await (const msg of opts.source.fetch({ cursor })) {
        result.totalMessages++;

        // Apply since filter
        if (opts.since) {
          const msgTime = new Date(msg.timestamp);
          const sinceTime = new Date(opts.since);
          if (msgTime < sinceTime) {
            continue;
          }
        }

        // Enforce limit after since filter
        accepted++;
        if (opts.limit && accepted > opts.limit) {
          break;
        }

        // Dedup check
        const dedupStatus = dedupStore.check(msg);

        if (dedupStatus === "unchanged") {
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
        })(),
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
      result.error = "LLM provider is required for non-dry-run execution";
      return result;
    }

    const extractor = createSignalExtractor(opts.provider);
    const privacyProcessor = new PrivacyProcessor(config.privacy);

    let adapter: Adapter;
    if (opts.adapter === "store") {
      if (!opts.stores) {
        result.fatal = true;
        result.error = "Store adapter requires stores context to be provided";
        return result;
      }
      adapter = new StoreAdapter(opts.stores);
    } else if (opts.adapter === "file") {
      adapter = new FileAdapter({
        output_dir: config.output_dir,
        format: opts.format,
      });
    } else if (opts.adapter === "gbrain") {
      adapter = new GBrainAdapter({
        output_dir: config.output_dir,
      });
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

    // Process blocks with concurrency
    const CONCURRENCY = config.block_concurrency ?? 5;
    const extractedResults: ExtractionResult[] = [];

    const processBlock = async (block: ConversationBlock, idx: number): Promise<void> => {
      process.stdout.write(`  [${idx + 1}/${blocks.length}] filtering block ${block.block_id} ...`);
      try {
        // L1: rule-based filter
        const l1Verdict = filterNoiseL1(block);
        let filterVerdict: NoiseFilterVerdict;

        if (l1Verdict !== null) {
          filterVerdict = l1Verdict;
        } else {
          // L2 replaced by signal scoring: canonicalize → scoreBlock → gate
          const cb = canonicalize(block);
          const score = scoreBlock(cb);
          filterVerdict = mapScoreDecision(score);
        }

        if (filterVerdict === "skip") {
          process.stdout.write(" skipped\n");
          result.skippedBlocks++;
          result.skippedMessages.push(...block.messages);
          return;
        }

        process.stdout.write(" extracting ...");
        const blockResult: BlockResult = await extractor.extract(block);

        if (blockResult.status === "failed") {
          process.stdout.write(` failed: ${blockResult.error}\n`);
          result.failedBlocks++;
          result.failedMessages.push(...block.messages);
          result.warnings.push(`Block ${block.block_id} extraction failed: ${blockResult.error}`);
          return;
        }

        if (blockResult.status === "skipped") {
          process.stdout.write(" skipped\n");
          result.skippedBlocks++;
          result.skippedMessages.push(...block.messages);
          return;
        }

        // Empty extraction guard: all signal arrays empty → skip
        const d = blockResult.data;
        if (
          d.entities.length === 0 &&
          d.timeline.length === 0 &&
          d.links.length === 0 &&
          d.decisions.length === 0 &&
          d.tasks.length === 0 &&
          d.discoveries.length === 0 &&
          d.knowledge.length === 0
        ) {
          process.stdout.write(" empty → skipped\n");
          result.skippedBlocks++;
          result.skippedMessages.push(...block.messages);
          return;
        }

        process.stdout.write(" ok\n");
        result.okBlocks++;
        result.okMessages.push(...block.messages);
        const processedResult = privacyProcessor.process(blockResult.data);
        extractedResults.push(processedResult);
        result.lastSuccessMessage = block.messages[block.messages.length - 1];
      } catch (err) {
        process.stdout.write(` error: ${err instanceof Error ? err.message : String(err)}\n`);
        result.failedBlocks++;
        result.failedMessages.push(...block.messages);
        result.warnings.push(
          `Block ${block.block_id} processing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    };

    // Run blocks in batches of CONCURRENCY
    for (let i = 0; i < blocks.length; i += CONCURRENCY) {
      const batch = blocks.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map((block, j) => processBlock(block, i + j)));
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

      // Commit cursor — check for CursorProvider (structured) or legacy string cursor
      const isCursorProvider = (s: unknown): s is import("./types.js").CursorProvider =>
        typeof s === "object" && s !== null && "getCommittableCursors" in s;

      if (isCursorProvider(opts.source)) {
        const cursors = opts.source.getCommittableCursors();
        if (Object.keys(cursors).length > 0) {
          cursorStore.setJSON(opts.source.id, cursors);
          cursorStore.commit();
        }
      } else if (result.lastSuccessMessage?.metadata?.cursor) {
        cursorStore.set(opts.source.id, String(result.lastSuccessMessage.metadata.cursor));
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

/**
 * Signal Extractor - Core LLM-based signal extraction
 *
 * Orchestrates the extraction of structured signals from conversation blocks:
 * 1. Formats conversation into readable text
 * 2. Calls LLM with structured JSON schema
 * 3. Validates output with Zod
 * 4. Retries once on validation failure with error feedback
 * 5. Returns BlockResult (ok/failed) - never returns empty on failure
 */

import type { ConversationBlock, BlockResult, RawMessage } from '../core/types.js';
import { parseExtractionResult } from '../core/schemas.js';
import type { LLMProvider, ChatMessage } from './providers/types.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Signal Extractor interface
 */
export interface SignalExtractor {
  extract(block: ConversationBlock): Promise<BlockResult>;
}

/**
 * Load prompt template from file
 */
function loadPrompt(filename: string): string {
  const path = join(__dirname, 'prompts', filename);
  return readFileSync(path, 'utf-8');
}

/**
 * Format conversation messages into readable text
 */
function formatConversation(messages: RawMessage[]): string {
  return messages
    .map((msg) => {
      const timestamp = new Date(msg.timestamp).toISOString();
      const direction = msg.direction === 'sent' ? '→' : '←';
      return `[${timestamp}] ${direction} ${msg.contact}: ${msg.content}`;
    })
    .join('\n');
}

/**
 * Hash function for generating raw_hash from conversation block
 */
function hashBlock(block: ConversationBlock): string {
  // Simple hash based on block metadata
  const data = `${block.platform}:${block.channel}:${block.block_id}:${block.start_time}`;
  return Buffer.from(data).toString('base64').slice(0, 16);
}

/**
 * Create a signal extractor with the given LLM provider
 */
export function createSignalExtractor(provider: LLMProvider): SignalExtractor {
  const systemPrompt = loadPrompt('system.md');
  const signalExtractPrompt = loadPrompt('signal-extract.md');

  return {
    async extract(block: ConversationBlock): Promise<BlockResult> {
      // Format conversation for LLM
      const conversationText = formatConversation(block.messages);

      // Build prompt with context
      const userPrompt = `${signalExtractPrompt}

## Conversation Block

**Platform:** ${block.platform}
**Channel:** ${block.channel}
**Thread ID:** ${block.thread_id || 'N/A'}
**Time Range:** ${block.start_time} to ${block.end_time}
**Participants:** ${block.participants.join(', ')}

## Messages

${conversationText}

## Instructions

Extract all signals from the above conversation following the schema and examples.
Output ONLY valid JSON matching ExtractionResultSchema.`;

      // First attempt
      let lastError: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const messages: ChatMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ];

          // If this is a retry, include error feedback
          if (attempt > 0 && lastError) {
            messages.push({
              role: 'user',
              content: `The previous response had validation errors:\n${lastError}\n\nPlease fix the issues and provide valid JSON matching the schema.`,
            });
          }

          // Call LLM
          const response = await provider.chat(messages, {
            responseFormat: 'json',
            temperature: 0.2,
            maxTokens: 4000,
          });

          // Parse and validate JSON
          let jsonData: unknown;
          try {
            jsonData = JSON.parse(response);
          } catch (err) {
            lastError = `JSON parse error: ${err instanceof Error ? err.message : String(err)}`;
            continue; // Retry
          }

          // Validate with Zod
          const result = parseExtractionResult(jsonData);

          // Success - ensure source has required metadata
          if (!result.source.raw_hash) {
            result.source.raw_hash = hashBlock(block);
          }
          if (!result.source.thread_id && block.thread_id) {
            result.source.thread_id = block.thread_id;
          }

          return { status: 'ok', data: result };
        } catch (err) {
          // Capture validation error for retry
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt === 1) {
            // Second attempt failed - give up
            return {
              status: 'failed',
              error: `Signal extraction validation failed after retry: ${lastError}`,
            };
          }
          // Continue to retry
        }
      }

      // Should not reach here, but handle it
      return {
        status: 'failed',
        error: `Signal extraction failed: ${lastError || 'unknown error'}`,
      };
    },
  };
}

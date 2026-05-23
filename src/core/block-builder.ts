import type { ConversationBlock, RawMessage } from "./types";

export interface BlockBuilderConfig {
  block_gap_minutes?: number;
  max_block_tokens?: number;
  max_block_messages?: number;
}

export class BlockBuilder {
  private config: Required<BlockBuilderConfig>;

  constructor(config: BlockBuilderConfig = {}) {
    this.config = {
      block_gap_minutes: config.block_gap_minutes ?? 30,
      max_block_tokens: config.max_block_tokens ?? 4000,
      max_block_messages: config.max_block_messages ?? 100,
    };
  }

  async *build(messages: AsyncGenerator<RawMessage>): AsyncGenerator<ConversationBlock> {
    let currentBlock: RawMessage[] = [];
    let currentTokens = 0;
    let currentThreadId: string | undefined;
    let lastTimestamp: Date | null = null;

    for await (const message of messages) {
      const messageTokens = this.estimateTokens(message.content);
      const messageTime = new Date(message.timestamp);
      const messageThreadId =
        (message.metadata?.root_id as string | undefined) ??
        (message.metadata?.thread_id as string | undefined) ??
        undefined;
      const effectiveThreadId = messageThreadId || undefined;

      let shouldSplit = false;

      // Rule 1: Thread/Reply boundary (highest priority)
      if (currentBlock.length > 0 && currentThreadId !== undefined && currentThreadId !== effectiveThreadId) {
        shouldSplit = true;
      }

      // Rule 2: Time gap
      if (!shouldSplit && lastTimestamp && currentBlock.length > 0) {
        const gapMinutes = (messageTime.getTime() - lastTimestamp.getTime()) / (1000 * 60);
        if (gapMinutes > this.config.block_gap_minutes) {
          shouldSplit = true;
        }
      }

      // Rule 3: Token budget
      if (
        !shouldSplit &&
        currentBlock.length > 0 &&
        currentTokens + messageTokens > this.config.max_block_tokens
      ) {
        shouldSplit = true;
      }

      // Rule 4: Message count
      if (!shouldSplit && currentBlock.length >= this.config.max_block_messages) {
        shouldSplit = true;
      }

      if (shouldSplit && currentBlock.length > 0) {
        yield this.finalizeBlock(currentBlock, currentTokens, currentThreadId);
        currentBlock = [];
        currentTokens = 0;
        currentThreadId = undefined;
      }

      // Add message to current block
      currentBlock.push(message);
      currentTokens += messageTokens;
      lastTimestamp = messageTime;
      if (currentThreadId === undefined && effectiveThreadId !== undefined) {
        currentThreadId = effectiveThreadId;
      }
    }

    // Yield final block if any messages remain
    if (currentBlock.length > 0) {
      yield this.finalizeBlock(currentBlock, currentTokens, currentThreadId);
    }
  }

  private finalizeBlock(
    messages: RawMessage[],
    tokenCount: number,
    threadId: string | undefined,
  ): ConversationBlock {
    const participants = Array.from(new Set(messages.map((m) => m.contact)));
    const startTime = messages[0].timestamp;
    const endTime = messages[messages.length - 1].timestamp;
    const platform = messages[0].platform;
    const channel = messages[0].channel;

    return {
      block_id: crypto.randomUUID(),
      platform,
      channel,
      thread_id: threadId,
      messages,
      start_time: startTime,
      end_time: endTime,
      participants,
      token_count: Math.round(tokenCount),
    };
  }

  private estimateTokens(content: string): number {
    let tokens = 0;
    let currentWord = "";
    let _isInEnglishWord = false;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const code = char.charCodeAt(0);

      // Check if character is Chinese (CJK Unified Ideographs and extensions)
      const isChinese =
        (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
        (code >= 0x3400 && code <= 0x4dbf) || // CJK Extension A
        (code >= 0x20000 && code <= 0x2a6df) || // CJK Extension B
        (code >= 0x2a700 && code <= 0x2b73f) || // CJK Extension C
        (code >= 0x2b740 && code <= 0x2b81f) || // CJK Extension D
        (code >= 0x2b820 && code <= 0x2ceaf) || // CJK Extension E
        (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
        (code >= 0x2f800 && code <= 0x2fa1f); // CJK Compatibility Ideographs Supplement

      if (isChinese) {
        // Finish current English word if any
        if (currentWord.length > 0) {
          tokens += 1.3; // English word
          currentWord = "";
          _isInEnglishWord = false;
        }
        // Chinese character
        tokens += 1.5;
      } else if (/\s/.test(char)) {
        // Whitespace - finish current word
        if (currentWord.length > 0) {
          tokens += 1.3;
          currentWord = "";
          _isInEnglishWord = false;
        }
      } else {
        // Regular character (English, punctuation, etc.)
        currentWord += char;
        _isInEnglishWord = true;
      }
    }

    // Add final word if any
    if (currentWord.length > 0) {
      tokens += 1.3;
    }

    return tokens;
  }
}

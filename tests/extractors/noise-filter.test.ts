/**
 * Tests for noise filter
 * L1: Rule-based filtering (system notifications, emoji-only, red packets)
 * L2: LLM-based significance judgment
 */

import { describe, it, expect } from 'vitest';
import { ConversationBlock } from '../../src/core/types';
import { createMockProvider } from '../../src/extractors/providers/mock';
import { filterNoise, NoiseFilterVerdict } from '../../src/extractors/noise-filter';

describe('NoiseFilter', () => {
  describe('L1: Rule-based filtering', () => {
    it('should skip system notification blocks', () => {
      const block: ConversationBlock = {
        block_id: 'b1',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'system',
            timestamp: '2026-05-19T10:00:00Z',
            content: '张三加入群聊',
            direction: 'received',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'system',
            timestamp: '2026-05-19T10:01:00Z',
            content: '李四退出群聊',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['system'],
        token_count: 10,
      };

      const verdict = filterNoise(block);
      expect(verdict).toBe('skip');
    });

    it('should skip emoji-only blocks', () => {
      const block: ConversationBlock = {
        block_id: 'b2',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '😂😂😂',
            direction: 'received',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '👍',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 5,
      };

      const verdict = filterNoise(block);
      expect(verdict).toBe('skip');
    });

    it('should skip red packet/transfer blocks', () => {
      const block: ConversationBlock = {
        block_id: 'b3',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '[红包]恭喜发财',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '[转账]已收款',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 5,
      };

      const verdict = filterNoise(block);
      expect(verdict).toBe('skip');
    });

    it('should escalate blocks with decision keywords', () => {
      const block: ConversationBlock = {
        block_id: 'b4',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '我们确定使用方案 A',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '同意，这个决定很合理',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 20,
      };

      const verdict = filterNoise(block);
      expect(verdict).toBe('escalate');
    });

    it('should escalate blocks with task assignment keywords', () => {
      const block: ConversationBlock = {
        block_id: 'b5',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '你来负责这个模块的开发',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '好的，deadline 是周五对吧',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 20,
      };

      const verdict = filterNoise(block);
      expect(verdict).toBe('escalate');
    });

    it('should pass normal conversation to L2', () => {
      const block: ConversationBlock = {
        block_id: 'b6',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '今天天气不错',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '是啊，适合出去玩',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 20,
      };

      const verdict = filterNoise(block);
      // L1 doesn't skip it, should go to L2
      expect(verdict).not.toBe('escalate');
      expect(verdict).not.toBe('skip');
    });
  });

  describe('L2: LLM-based significance judgment', () => {
    it('should skip blocks with worth_processing: false', async () => {
      const mockProvider = createMockProvider(
        new Map([
          [
            'significance',
            JSON.stringify({
              worth_processing: false,
              confidence: 0.8,
              reason: 'Small talk with no actionable content',
              topics: [],
            }),
          ],
        ])
      );

      const block: ConversationBlock = {
        block_id: 'b7',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '哈哈哈',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '太搞笑了',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 10,
      };

      const verdict = await filterNoise(block, mockProvider);
      expect(verdict).toBe('skip');
    });

    it('should skip blocks with low confidence (<0.3)', async () => {
      const mockProvider = createMockProvider(
        new Map([
          [
            'significance',
            JSON.stringify({
              worth_processing: true,
              confidence: 0.2,
              reason: 'Unclear context, might be relevant but uncertain',
              topics: ['possibly-work'],
            }),
          ],
        ])
      );

      const block: ConversationBlock = {
        block_id: 'b8',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '那个东西怎么样了',
            direction: 'sent',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:00:00Z',
        participants: ['user1'],
        token_count: 10,
      };

      const verdict = await filterNoise(block, mockProvider);
      expect(verdict).toBe('skip');
    });

    it('should pass blocks with worth_processing: true and confidence >= 0.3', async () => {
      const mockProvider = createMockProvider(
        new Map([
          [
            'significance',
            JSON.stringify({
              worth_processing: true,
              confidence: 0.8,
              reason: 'Technical discussion about system architecture',
              topics: ['system-design', 'architecture'],
            }),
          ],
        ])
      );

      const block: ConversationBlock = {
        block_id: 'b9',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '我们的微服务架构需要改进',
            direction: 'sent',
          },
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user2',
            timestamp: '2026-05-19T10:01:00Z',
            content: '对，目前的服务拆分粒度不够合理',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:01:00Z',
        participants: ['user1', 'user2'],
        token_count: 30,
      };

      const verdict = await filterNoise(block, mockProvider);
      expect(verdict).toBe('pass');
    });

    it('should handle JSON parsing errors gracefully', async () => {
      const mockProvider = createMockProvider(
        new Map([['significance', 'invalid json']])
      );

      const block: ConversationBlock = {
        block_id: 'b10',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '测试消息',
            direction: 'sent',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:00:00Z',
        participants: ['user1'],
        token_count: 5,
      };

      await expect(filterNoise(block, mockProvider)).rejects.toThrow();
    });
  });

  describe('Integration: L1 + L2', () => {
    it('should skip in L1 and never call L2 for system notifications', async () => {
      let l2Called = false;
      const mockProvider = createMockProvider(new Map());
      // Override chat to track if it's called
      const trackingProvider = {
        async chat() {
          l2Called = true;
          return '{}';
        },
      };

      const block: ConversationBlock = {
        block_id: 'b11',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'system',
            timestamp: '2026-05-19T10:00:00Z',
            content: '张三撤回了一条消息',
            direction: 'received',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:00:00Z',
        participants: ['system'],
        token_count: 5,
      };

      const verdict = await filterNoise(block, trackingProvider);
      expect(verdict).toBe('skip');
      expect(l2Called).toBe(false);
    });

    it('should escalate in L1 and never call L2 for decision blocks', async () => {
      let l2Called = false;
      const trackingProvider = {
        async chat() {
          l2Called = true;
          return '{}';
        },
      };

      const block: ConversationBlock = {
        block_id: 'b12',
        platform: 'wechat',
        channel: 'group-123',
        messages: [
          {
            platform: 'wechat',
            channel: 'group-123',
            contact: 'user1',
            timestamp: '2026-05-19T10:00:00Z',
            content: '我们决定采用 Redis 作为缓存方案',
            direction: 'sent',
          },
        ],
        start_time: '2026-05-19T10:00:00Z',
        end_time: '2026-05-19T10:00:00Z',
        participants: ['user1'],
        token_count: 15,
      };

      const verdict = await filterNoise(block, trackingProvider);
      expect(verdict).toBe('escalate');
      expect(l2Called).toBe(false);
    });
  });
});

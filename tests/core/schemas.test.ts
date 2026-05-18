/**
 * Tests for Zod schemas and validation functions
 */

import { describe, it, expect } from 'vitest';
import {
  parseExtractionResult,
  parseSignificanceVerdict,
  ExtractionResultSchema,
  SignificanceVerdictSchema,
} from '../../src/core/schemas.js';
import type { ExtractionResult, SignificanceVerdict } from '../../src/core/types.js';

describe('ExtractionResult schema validation', () => {
  it('should parse valid ExtractionResult JSON', () => {
    const validData: ExtractionResult = {
      source: {
        platform: 'slack',
        channel: '#engineering',
        timestamp: '2026-05-19T12:00:00Z',
        message_id: 'msg-123',
        raw_hash: 'abc123',
        quote: 'Discussing the new API design',
      },
      entities: [
        {
          slug: 'api-redesign',
          name: 'API Redesign Project',
          type: 'project',
          context: 'Major refactoring of REST API',
          confidence: 'direct',
        },
      ],
      timeline: [
        {
          date: '2026-05-19',
          summary: 'Started API redesign discussion',
          entities: ['api-redesign'],
          source: {
            platform: 'slack',
            channel: '#engineering',
            timestamp: '2026-05-19T12:00:00Z',
            raw_hash: 'abc123',
            quote: 'Let\'s start the API redesign',
          },
          confidence: 'direct',
        },
      ],
      links: [
        {
          from: 'john-doe',
          to: 'api-redesign',
          type: 'works_on',
          context: 'John is leading the API redesign',
          confidence: 'direct',
        },
      ],
      decisions: [
        {
          summary: 'Use GraphQL instead of REST',
          reasoning: 'Better type safety and flexibility',
          alternatives: ['Keep REST', 'Use gRPC'],
          entities: ['api-redesign'],
          date: '2026-05-19',
          confidence: 'direct',
          source: {
            platform: 'slack',
            channel: '#engineering',
            timestamp: '2026-05-19T12:00:00Z',
            raw_hash: 'abc123',
            quote: 'We decided to go with GraphQL',
          },
        },
      ],
      tasks: [
        {
          title: 'Design GraphQL schema',
          status: 'open',
          owner: 'john-doe',
          project: 'api-redesign',
          confidence: 'direct',
          source: {
            platform: 'slack',
            channel: '#engineering',
            timestamp: '2026-05-19T12:00:00Z',
            raw_hash: 'abc123',
            quote: 'John will design the GraphQL schema',
          },
        },
      ],
      discoveries: [
        {
          summary: 'Team prefers TypeScript for API development',
          type: 'preference',
          entities: ['api-redesign'],
          confidence: 'inferred',
          source: {
            platform: 'slack',
            channel: '#engineering',
            timestamp: '2026-05-19T12:00:00Z',
            raw_hash: 'abc123',
            quote: 'Everyone seems comfortable with TypeScript',
          },
        },
      ],
    };

    const result = parseExtractionResult(validData);
    expect(result).toEqual(validData);
  });

  it('should throw ZodError with field name when required field is missing', () => {
    const invalidData = {
      source: {
        platform: 'slack',
        channel: '#engineering',
        timestamp: '2026-05-19T12:00:00Z',
        // missing raw_hash
        quote: 'test',
      },
      entities: [],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    expect(() => parseExtractionResult(invalidData)).toThrow(/raw_hash.*Required/);
  });

  it('should throw ZodError when confidence value is invalid', () => {
    const invalidData = {
      source: {
        platform: 'slack',
        channel: '#engineering',
        timestamp: '2026-05-19T12:00:00Z',
        raw_hash: 'abc123',
        quote: 'test',
      },
      entities: [
        {
          slug: 'test',
          name: 'Test Entity',
          type: 'project',
          context: 'test context',
          confidence: 'invalid_confidence', // Invalid value
        },
      ],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    expect(() => parseExtractionResult(invalidData)).toThrow(/confidence/);
  });

  it('should throw ZodError when entity type is invalid', () => {
    const invalidData = {
      source: {
        platform: 'slack',
        channel: '#engineering',
        timestamp: '2026-05-19T12:00:00Z',
        raw_hash: 'abc123',
        quote: 'test',
      },
      entities: [
        {
          slug: 'test',
          name: 'Test Entity',
          type: 'invalid_type', // Invalid type
          context: 'test context',
          confidence: 'direct',
        },
      ],
      timeline: [],
      links: [],
      decisions: [],
      tasks: [],
      discoveries: [],
    };

    expect(() => parseExtractionResult(invalidData)).toThrow(/type/);
  });
});

describe('SignificanceVerdict schema validation', () => {
  it('should parse valid SignificanceVerdict', () => {
    const validVerdict: SignificanceVerdict = {
      worth_processing: true,
      reason: 'Contains important technical decisions',
      topics: ['api-design', 'architecture'],
      confidence: 0.85,
    };

    const result = parseSignificanceVerdict(validVerdict);
    expect(result).toEqual(validVerdict);
  });

  it('should throw ZodError when required field is missing', () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: 'test',
      // missing topics
      confidence: 0.8,
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/topics.*Required/);
  });

  it('should throw ZodError when confidence is out of range', () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: 'test',
      topics: ['test'],
      confidence: 1.5, // Out of range (0-1)
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/confidence/);
  });

  it('should throw ZodError when confidence is negative', () => {
    const invalidVerdict = {
      worth_processing: true,
      reason: 'test',
      topics: ['test'],
      confidence: -0.1, // Negative
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/confidence/);
  });

  it('should accept confidence at boundaries (0 and 1)', () => {
    const verdict1: SignificanceVerdict = {
      worth_processing: false,
      reason: 'test',
      topics: [],
      confidence: 0,
    };

    const verdict2: SignificanceVerdict = {
      worth_processing: true,
      reason: 'test',
      topics: ['test'],
      confidence: 1,
    };

    expect(parseSignificanceVerdict(verdict1)).toEqual(verdict1);
    expect(parseSignificanceVerdict(verdict2)).toEqual(verdict2);
  });

  it('should throw ZodError when worth_processing is not boolean', () => {
    const invalidVerdict = {
      worth_processing: 'yes', // Should be boolean
      reason: 'test',
      topics: ['test'],
      confidence: 0.8,
    };

    expect(() => parseSignificanceVerdict(invalidVerdict)).toThrow(/worth_processing/);
  });
});

describe('LinkType validation', () => {
  it('should accept all valid link types', () => {
    const linkTypes = [
      'works_on',
      'works_at',
      'reports_to',
      'collaborates',
      'depends_on',
      'mentions',
      'custom',
    ];

    linkTypes.forEach((type) => {
      const data = {
        source: {
          platform: 'slack',
          channel: '#engineering',
          timestamp: '2026-05-19T12:00:00Z',
          raw_hash: 'abc123',
          quote: 'test',
        },
        entities: [],
        timeline: [],
        links: [
          {
            from: 'entity-a',
            to: 'entity-b',
            type,
            context: 'test context',
            confidence: 'direct',
          },
        ],
        decisions: [],
        tasks: [],
        discoveries: [],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

describe('TaskSignal status validation', () => {
  it('should accept all valid task statuses', () => {
    const statuses = ['open', 'in_progress', 'done', 'cancelled'];

    statuses.forEach((status) => {
      const data = {
        source: {
          platform: 'slack',
          channel: '#engineering',
          timestamp: '2026-05-19T12:00:00Z',
          raw_hash: 'abc123',
          quote: 'test',
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [
          {
            title: 'Test task',
            status,
            confidence: 'direct',
            source: {
              platform: 'slack',
              channel: '#engineering',
              timestamp: '2026-05-19T12:00:00Z',
              raw_hash: 'abc123',
              quote: 'test',
            },
          },
        ],
        discoveries: [],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

describe('Discovery type validation', () => {
  it('should accept all valid discovery types', () => {
    const types = ['procedure', 'preference', 'pattern', 'insight'];

    types.forEach((type) => {
      const data = {
        source: {
          platform: 'slack',
          channel: '#engineering',
          timestamp: '2026-05-19T12:00:00Z',
          raw_hash: 'abc123',
          quote: 'test',
        },
        entities: [],
        timeline: [],
        links: [],
        decisions: [],
        tasks: [],
        discoveries: [
          {
            summary: 'Test discovery',
            type,
            entities: [],
            confidence: 'direct',
            source: {
              platform: 'slack',
              channel: '#engineering',
              timestamp: '2026-05-19T12:00:00Z',
              raw_hash: 'abc123',
              quote: 'test',
            },
          },
        ],
      };

      expect(() => parseExtractionResult(data)).not.toThrow();
    });
  });
});

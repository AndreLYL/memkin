/**
 * Zod runtime validation schemas for LLM output
 * Corresponds to types in types.ts but with runtime validation
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import type { ExtractionResult, SignificanceVerdict } from "./types.js";

// Base schemas
export const SignalConfidenceSchema = z.enum(["direct", "paraphrased", "inferred", "speculative"]);

export const SourceRefSchema = z.object({
  platform: z.string(),
  channel: z.string(),
  channel_name: z.string().optional(),
  timestamp: z.string(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  message_id: z.string().optional(),
  message_ids: z.array(z.string()).optional(),
  thread_id: z.string().optional(),
  file_path: z.string().optional(),
  line_range: z.object({ start: z.number(), end: z.number() }).optional(),
  attachment_id: z.string().optional(),
  url: z.string().optional(),
  raw_hash: z.string().default(""),
  quote: z.string().default(""),
});

// Signal schemas
export const EntitySchema = z.object({
  slug: z.string(),
  name: z.string(),
  type: z.enum(["person", "project", "organization", "tool", "concept"]),
  context: z.string(),
  confidence: SignalConfidenceSchema,
});

export const TimelineEntrySchema = z.object({
  date: z.string(), // ISO 8601 or partial
  summary: z.string(),
  entities: z.array(z.string()), // slugs
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

const KNOWN_LINK_TYPES = [
  "works_on",
  "works_at",
  "reports_to",
  "collaborates",
  "depends_on",
  "mentions",
  "approves",
  "uses",
  "custom",
] as const;

export const LinkTypeSchema = z
  .string()
  .transform((v) =>
    (KNOWN_LINK_TYPES as readonly string[]).includes(v) ? v : "custom",
  ) as unknown as z.ZodType<(typeof KNOWN_LINK_TYPES)[number]>;

export const LinkSchema = z.object({
  from: z.string(), // entity slug
  to: z.string(), // entity slug
  type: LinkTypeSchema,
  context: z.string(),
  confidence: SignalConfidenceSchema,
  source: SourceRefSchema,
});

export const DecisionSchema = z.object({
  summary: z.string(),
  reasoning: z.string().optional(),
  alternatives: z.array(z.string()).optional(),
  entities: z.array(z.string()), // slugs
  date: z.string(), // ISO 8601
  valid_at: z.string().optional(), // ISO 8601
  invalid_at: z.string().optional(), // ISO 8601
  confidence: SignalConfidenceSchema,
  source: SourceRefSchema,
});

export const TaskSignalSchema = z.object({
  title: z.string(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]),
  owner: z.string().optional(),
  project: z.string().optional(),
  due_date: z.string().optional(), // ISO 8601
  valid_at: z.string().optional(), // ISO 8601
  invalid_at: z.string().optional(), // ISO 8601
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

const KNOWN_DISCOVERY_TYPES = ["procedure", "preference", "pattern", "insight", "risk"] as const;

export const DiscoverySchema = z.object({
  summary: z.string(),
  detail: z.string().optional(),
  type: z
    .string()
    .transform((v) =>
      (KNOWN_DISCOVERY_TYPES as readonly string[]).includes(v) ? v : "insight",
    ) as unknown as z.ZodType<(typeof KNOWN_DISCOVERY_TYPES)[number]>,
  entities: z.array(z.string()), // slugs
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

export const KnowledgeSourceTypeSchema = z.enum(["conversation", "document", "teaching"]);

function normalizeTopicSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug.length >= 3) return slug;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return slug ? `${slug}-${hash}` : hash;
}

export const KnowledgeSchema = z
  .object({
    topic: z.string().min(1).transform(normalizeTopicSlug),
    content: z.string().min(1),
    source_type: KnowledgeSourceTypeSchema,
    related_entities: z.array(z.string()),
    valid_at: z.string().optional(),
    invalid_at: z.string().optional(),
    source: SourceRefSchema,
    confidence: SignalConfidenceSchema,
  })
  .refine((k) => !k.valid_at || !k.invalid_at || k.invalid_at > k.valid_at, {
    message: "invalid_at must be after valid_at",
  });

// Full extraction result schema
export const ExtractionResultSchema = z.object({
  source: SourceRefSchema,
  entities: z.array(EntitySchema),
  timeline: z.array(TimelineEntrySchema),
  links: z.array(LinkSchema),
  decisions: z.array(DecisionSchema),
  tasks: z.array(TaskSignalSchema),
  discoveries: z.array(DiscoverySchema),
  knowledge: z.array(KnowledgeSchema).default([]),
});

// Significance verdict schema (L2 judgment)
export const SignificanceVerdictSchema = z.object({
  worth_processing: z.boolean(),
  reason: z.string(),
  topics: z.array(z.string()),
  confidence: z.number().min(0).max(1), // 0.0 to 1.0
});

/**
 * Parse and validate LLM output as ExtractionResult
 * @param raw - Raw JSON from LLM (unknown type)
 * @returns Validated ExtractionResult
 * @throws ZodError with clear field-level validation messages
 */
export function parseExtractionResult(raw: unknown): ExtractionResult {
  try {
    return ExtractionResultSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Enhance error messages for better debugging
      const formattedErrors = error.errors.map((err) => {
        const path = err.path.join(".");
        return `${path}: ${err.message}`;
      });
      throw new Error(`ExtractionResult validation failed:\n${formattedErrors.join("\n")}`, {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * Parse and validate LLM output as SignificanceVerdict
 * @param raw - Raw JSON from LLM (unknown type)
 * @returns Validated SignificanceVerdict
 * @throws ZodError with clear field-level validation messages
 */
export function parseSignificanceVerdict(raw: unknown): SignificanceVerdict {
  try {
    return SignificanceVerdictSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = error.errors.map((err) => {
        const path = err.path.join(".");
        return `${path}: ${err.message}`;
      });
      throw new Error(`SignificanceVerdict validation failed:\n${formattedErrors.join("\n")}`, {
        cause: error,
      });
    }
    throw error;
  }
}

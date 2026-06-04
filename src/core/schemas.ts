/**
 * Zod runtime validation schemas for LLM output
 * Corresponds to types in types.ts but with runtime validation
 */

import { z } from "zod";
import type { ExtractionResult, SignificanceVerdict } from "./types.js";

// Base schemas
export const SignalConfidenceSchema = z.enum(["direct", "paraphrased", "inferred", "speculative"]);

// Coerce null → undefined for optional string fields (LLM sometimes outputs null)
const optionalString = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => (v == null ? undefined : v));

// Accept both full ISO datetime and date-only strings like "2026-05-27"
const optionalDatetime = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v == null) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const normalized = `${v}T00:00:00.000Z`;
      if (!Number.isNaN(Date.parse(normalized))) return normalized;
    }
    if (/^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) {
      return v;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid ISO 8601 datetime" });
    return z.NEVER;
  });

export const SourceRefSchema = z.object({
  platform: z.string(),
  channel: z.string(),
  timestamp: z.string().default(() => new Date().toISOString()),
  message_id: optionalString,
  thread_id: optionalString,
  file_path: optionalString,
  line_range: z.object({ start: z.number(), end: z.number() }).optional(),
  attachment_id: optionalString,
  url: optionalString,
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

const VALID_LINK_TYPES = [
  "works_on",
  "works_at",
  "reports_to",
  "collaborates",
  "depends_on",
  "mentions",
  "custom",
] as const;

export const LinkTypeSchema = z
  .string()
  .transform((val) =>
    (VALID_LINK_TYPES as readonly string[]).includes(val) ? val : "custom",
  ) as z.ZodType<(typeof VALID_LINK_TYPES)[number]>;

export const LinkSchema = z.object({
  from: z.string(), // entity slug
  to: z.string(), // entity slug
  type: LinkTypeSchema,
  context: z.string(),
  confidence: SignalConfidenceSchema,
  source: SourceRefSchema.optional().transform(
    (v) =>
      v ?? {
        platform: "",
        channel: "",
        timestamp: new Date().toISOString(),
        raw_hash: "",
        quote: "",
      },
  ),
});

export const DecisionSchema = z.object({
  summary: z.string(),
  reasoning: optionalString,
  alternatives: z.array(z.string()).optional(),
  entities: z.array(z.string()),
  date: z.string(),
  valid_at: optionalDatetime,
  invalid_at: optionalDatetime,
  confidence: SignalConfidenceSchema,
  source: SourceRefSchema,
});

export const TaskSignalSchema = z.object({
  title: z.string(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]),
  owner: optionalString,
  project: optionalString,
  due_date: optionalDatetime,
  valid_at: optionalDatetime,
  invalid_at: optionalDatetime,
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

export const DiscoverySchema = z.object({
  summary: z.string(),
  detail: z.string().optional(),
  type: z.enum(["procedure", "preference", "pattern", "insight"]),
  entities: z.array(z.string()), // slugs
  source: SourceRefSchema,
  confidence: SignalConfidenceSchema,
});

export const KnowledgeSourceTypeSchema = z.enum(["conversation", "document", "teaching"]);

function normalizeTopicSlug(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿㐀-䶿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (slug) return slug;
  // Fallback: generate hash-based slug for pure non-latin text
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(12, "0").slice(0, 12);
}

export const KnowledgeSchema = z
  .object({
    topic: z.string().min(1).transform(normalizeTopicSlug),
    content: z.string().min(1),
    source_type: KnowledgeSourceTypeSchema,
    related_entities: z.array(z.string()),
    valid_at: optionalDatetime,
    invalid_at: optionalDatetime,
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

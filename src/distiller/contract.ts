/**
 * Distillation output contract v4 (spec §5).
 *
 * A `DistilledPayload` is the target-agnostic, immutable product of session
 * distillation: a set of signals, each a member of a Zod discriminated union
 * keyed by `type`. PR-2 only produces and persists this payload; it never
 * writes pages (that is PR-4's apply engine).
 *
 * Design notes:
 * - Discriminated union: every `type` carries its own additional fields and
 *   admission rules. Strict validation — the distiller retries once on failure
 *   before parking the revision in `retrying`.
 * - authority is a three-value ladder (user_confirmed / assistant_claimed /
 *   assistant_proposed). The per-type admissibility matrix lives in
 *   authority-matrix.ts (spec §5).
 * - Dates use ISO 8601 (z.string().datetime()).
 * - preference.category and knowledge.source_kind are closed enums, not free
 *   text.
 * - reference.url is required and must additionally be locatable inside the
 *   evidence message text — that cross-check lives in msg-id.ts (it needs the
 *   transcript), not here.
 * - Payload-internal dedup: no two signals may share (type, slugify(topic)).
 *   That guarantee is why the two-layer ID scheme (spec §6.1) needs no ordinal.
 */

import { z } from "zod";

// ── Enums ──────────────────────────────────────────────────────────────────

export const SignalTypeSchema = z.enum([
  "decision",
  "task",
  "reference",
  "preference",
  "knowledge",
  "discovery",
]);
export type SignalType = z.infer<typeof SignalTypeSchema>;

export const AuthoritySchema = z.enum([
  "user_confirmed",
  "assistant_claimed",
  "assistant_proposed",
]);
export type Authority = z.infer<typeof AuthoritySchema>;

export const TaskStatusSchema = z.enum(["open", "in_progress", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const PreferenceCategorySchema = z.enum([
  "tooling",
  "workflow",
  "communication",
  "coding_style",
  "ui",
  "personal",
  "other",
]);
export type PreferenceCategory = z.infer<typeof PreferenceCategorySchema>;

export const KnowledgeSourceKindSchema = z.enum([
  "documentation",
  "experiment",
  "external_reference",
  "domain_fact",
  "observation",
]);
export type KnowledgeSourceKind = z.infer<typeof KnowledgeSourceKindSchema>;

export const DiscoverySubtypeSchema = z.enum(["insight", "pattern", "risk", "procedure"]);
export type DiscoverySubtype = z.infer<typeof DiscoverySubtypeSchema>;

// ── Evidence ─────────────────────────────────────────────────────────────────
// A programmatic msg_id range. IDs are assigned by the pipeline (msg-id.ts);
// the model may only reference given IDs, and bounds are checked there.

export const MsgRangeSchema = z.object({
  start: z.string().min(1),
  end: z.string().min(1),
});
export type MsgRange = z.infer<typeof MsgRangeSchema>;

// ── Common fields (all signals) ──────────────────────────────────────────────

const commonShape = {
  topic: z.string().min(1),
  what: z.string().min(1),
  why: z.string().optional(),
  project: z.string().optional(),
  entities: z.array(z.string()),
  authority: AuthoritySchema,
  supersedes_topic: z.string().optional(),
  evidence: z.array(MsgRangeSchema).min(1),
  persistence_reason: z.string().min(1),
};

// An ISO 8601 date-time string. z.string().datetime() rejects date-only forms.
const isoDate = z.string().datetime();

// ── Per-type variants ─────────────────────────────────────────────────────────

export const DecisionSignalSchema = z.object({
  type: z.literal("decision"),
  ...commonShape,
});

export const TaskSignalSchema = z.object({
  type: z.literal("task"),
  ...commonShape,
  owner: z.string().optional(),
  due_date: isoDate.optional(),
  status: TaskStatusSchema,
});

export const ReferenceSignalSchema = z.object({
  type: z.literal("reference"),
  ...commonShape,
  url: z.string().min(1),
  trigger: z.string().optional(),
});

export const PreferenceSignalSchema = z.object({
  type: z.literal("preference"),
  ...commonShape,
  subject: z.string().min(1),
  category: PreferenceCategorySchema,
});

export const KnowledgeSignalSchema = z.object({
  type: z.literal("knowledge"),
  ...commonShape,
  source_kind: KnowledgeSourceKindSchema,
  valid_at: isoDate.optional(),
  invalid_at: isoDate.optional(),
});

export const DiscoverySignalSchema = z.object({
  type: z.literal("discovery"),
  ...commonShape,
  subtype: DiscoverySubtypeSchema,
});

export const DistilledSignalSchema = z.discriminatedUnion("type", [
  DecisionSignalSchema,
  TaskSignalSchema,
  ReferenceSignalSchema,
  PreferenceSignalSchema,
  KnowledgeSignalSchema,
  DiscoverySignalSchema,
]);
export type DistilledSignal = z.infer<typeof DistilledSignalSchema>;

// ── Payload ───────────────────────────────────────────────────────────────────
// Payload-internal dedup on (type, slugify(topic)) is enforced by a superRefine
// so callers get a single validation surface.

export const DistilledPayloadSchema = z
  .object({
    signals: z.array(DistilledSignalSchema),
  })
  .superRefine((payload, ctx) => {
    const seen = new Set<string>();
    for (let i = 0; i < payload.signals.length; i++) {
      const s = payload.signals[i];
      const key = `${s.type}::${slugifyTopic(s.topic)}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["signals", i, "topic"],
          message: `duplicate (type, slugify(topic)): "${key}" — merge these signals`,
        });
      }
      seen.add(key);
    }
  });
export type DistilledPayload = z.infer<typeof DistilledPayloadSchema>;

/**
 * Deterministic topic slug used both for payload-internal dedup and downstream
 * ID derivation (spec §6.1 normalized_topic). Lowercase, collapse whitespace,
 * strip punctuation, hyphenate.
 */
export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export type ParsePayloadResult =
  | { ok: true; payload: DistilledPayload }
  | { ok: false; error: z.ZodError };

/** Safe-parse wrapper returning a discriminated result rather than throwing. */
export function parsePayload(input: unknown): ParsePayloadResult {
  const res = DistilledPayloadSchema.safeParse(input);
  if (res.success) return { ok: true, payload: res.data };
  return { ok: false, error: res.error };
}

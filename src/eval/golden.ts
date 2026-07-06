/**
 * Golden annotation format: for a given session, the set of signals a human
 * annotator judges the pipeline *should* have extracted (`should_record`), plus
 * illustrative examples of things it should *not* have extracted
 * (`should_not_record`) — e.g. transient chatter, unconfirmed proposals.
 *
 * This module only defines and validates the format. The actual human annotation
 * of real sessions is a separate, manual step (see docs/eval-annotation-guide.md)
 * — golden datasets built from real (potentially private) sessions are gitignored
 * and kept locally; only a sanitized example fixture ships in the repo.
 *
 * Spec: memoark-2026-07-06-extraction-quality-redesign.md §10, §5 (signal shape).
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";

// Mirrors the signal `type` discriminant from the v4 distillation contract (spec §5).
// Kept as a local literal union here (rather than importing from the not-yet-built
// PR-2 distiller contract) so PR-1 has no dependency on PR-2.
export const GoldenSignalTypeSchema = z.enum([
  "decision",
  "task",
  "reference",
  "preference",
  "knowledge",
  "discovery",
]);
export type GoldenSignalType = z.infer<typeof GoldenSignalTypeSchema>;

// Mirrors the `authority` discriminant from spec §5.
export const GoldenAuthoritySchema = z.enum([
  "user_confirmed",
  "assistant_proposed",
  "assistant_claimed",
]);
export type GoldenAuthority = z.infer<typeof GoldenAuthoritySchema>;

export const GoldenSignalSchema = z.object({
  type: GoldenSignalTypeSchema,
  authority: GoldenAuthoritySchema,
  topic: z.string().min(1),
  what: z.string().min(1),
});
export type GoldenSignal = z.infer<typeof GoldenSignalSchema>;

export const NegativeExampleSchema = z.object({
  what: z.string().min(1),
  reason: z.string().min(1).optional(),
});
export type NegativeExample = z.infer<typeof NegativeExampleSchema>;

export const GoldenAnnotationSchema = z.object({
  session_ref: z.string().min(1),
  should_record: z.array(GoldenSignalSchema),
  should_not_record: z.array(NegativeExampleSchema),
});
export type GoldenAnnotation = z.infer<typeof GoldenAnnotationSchema>;

/**
 * Load and validate a golden annotation from a JSON file on disk.
 * Throws (with a descriptive message) if the file is missing, not valid JSON,
 * or fails schema validation.
 */
export async function loadGolden(path: string): Promise<GoldenAnnotation> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read golden annotation at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse golden annotation at ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = GoldenAnnotationSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid golden annotation at ${path}: ${result.error.message}`);
  }
  return result.data;
}

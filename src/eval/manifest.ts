/**
 * Eval manifest: a versioned, reproducible record of which sessions belong to the
 * golden dataset, which split (tune/holdout) each falls into, and a hash of the
 * annotation content at the time the manifest was created.
 *
 * The manifest itself is safe to commit (it only references sessions by opaque
 * `session_ref` and stores a hash of the annotation, not the annotation content).
 * The actual golden dataset (real session transcripts + human annotations) is
 * gitignored and lives locally — see src/eval/golden.ts and .gitignore.
 *
 * Spec: memoark-2026-07-06-extraction-quality-redesign.md §10 (质量度量).
 * Holdout is locked once created: acceptance is judged only on the holdout split
 * (see src/eval/metrics.ts `report`), never on the full dataset, to avoid
 * training-set leakage into the pass/fail decision.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";

export const EvalSplitSchema = z.enum(["tune", "holdout"]);
export type EvalSplit = z.infer<typeof EvalSplitSchema>;

export const ManifestSessionSchema = z.object({
  /** Opaque reference to a session, e.g. "claude-code:sess-1". Resolution to an
   * actual transcript path/DB row is the caller's responsibility. */
  session_ref: z.string().min(1),
  split: EvalSplitSchema,
  /** Hash (e.g. sha256) of the golden annotation content for this session, so a
   * manifest can detect when annotations have drifted since it was recorded. */
  annotation_hash: z.string().min(1),
});
export type ManifestSession = z.infer<typeof ManifestSessionSchema>;

export const EvalManifestSchema = z
  .object({
    version: z.number().int().positive(),
    sessions: z.array(ManifestSessionSchema),
    created_at: z.string().datetime(),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const [i, session] of manifest.sessions.entries()) {
      if (seen.has(session.session_ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate session_ref: ${session.session_ref}`,
          path: ["sessions", i, "session_ref"],
        });
      }
      seen.add(session.session_ref);
    }
  });
export type EvalManifest = z.infer<typeof EvalManifestSchema>;

/**
 * Load and validate an eval manifest from a JSON file on disk.
 * Throws (with a descriptive message) if the file is missing, not valid JSON,
 * or fails schema validation.
 */
export async function loadManifest(path: string): Promise<EvalManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read eval manifest at ${path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Failed to parse eval manifest at ${path} as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = EvalManifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid eval manifest at ${path}: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Partition manifest sessions into tune (~70%) and holdout (~30%) arrays per
 * their recorded `split`. The manifest is the source of truth for the split —
 * this function does not re-randomize; it only groups by the already-assigned
 * `split` field so the holdout stays locked across runs.
 */
export function splitSessions(manifest: EvalManifest): {
  tune: ManifestSession[];
  holdout: ManifestSession[];
} {
  const tune = manifest.sessions.filter((s) => s.split === "tune");
  const holdout = manifest.sessions.filter((s) => s.split === "holdout");
  return { tune, holdout };
}

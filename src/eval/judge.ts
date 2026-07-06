/**
 * LLM-as-judge semantic matcher: compares pipeline-extracted signals against a
 * golden annotation for the same session and buckets each signal into
 * matched / missed / extra.
 *
 * Matching rule (spec §10): same `type` AND semantically equivalent `what`.
 * Type is checked programmatically (cheap, deterministic); semantic equivalence
 * within a type is delegated to a JudgeClient, which in production wraps the
 * existing LLMProvider abstraction (see createLLMJudgeClient below) so no new
 * LLM dependency is introduced — the same MiniMax-backed provider used
 * elsewhere in the codebase is reused here.
 *
 * The judge is calibrated against 5 hand-picked human judgment examples before
 * being trusted on golden data — see CALIBRATION_EXAMPLES and calibrateJudge().
 */

import type { LLMProvider } from "../extractors/providers/types.js";
import type {
  GoldenAnnotation,
  GoldenAuthority,
  GoldenSignal,
  GoldenSignalType,
} from "./golden.js";

export interface PipelineSignal {
  type: GoldenSignalType;
  topic: string;
  what: string;
  authority?: GoldenAuthority;
}

/**
 * Minimal interface the judge depends on: "are these two descriptions of a
 * signal semantically equivalent?" Kept narrow and injectable so tests can
 * supply a deterministic mock instead of calling a real LLM.
 */
export interface JudgeClient {
  isEquivalent(a: string, b: string): Promise<boolean>;
}

export interface JudgeResult {
  matched: Array<{ pipeline: PipelineSignal; golden: GoldenSignal }>;
  missed: GoldenSignal[];
  extra: PipelineSignal[];
}

/**
 * Compare pipeline output signals against a golden annotation.
 *
 * Algorithm: for each pipeline signal (in order), find the first not-yet-matched
 * golden signal of the same `type` that the judge client considers semantically
 * equivalent. Matched pairs are removed from further consideration (one pipeline
 * signal matches at most one golden signal, and vice versa) — this prevents a
 * single golden signal from being "matched" multiple times when the judge client
 * is permissive.
 */
export async function judge(
  output: PipelineSignal[],
  golden: GoldenAnnotation,
  client: JudgeClient,
): Promise<JudgeResult> {
  const remainingGolden = [...golden.should_record];
  const matched: JudgeResult["matched"] = [];
  const extra: PipelineSignal[] = [];

  for (const signal of output) {
    let matchIndex = -1;
    for (let i = 0; i < remainingGolden.length; i++) {
      const candidate = remainingGolden[i];
      if (candidate.type !== signal.type) continue;
      // Sequential await is intentional: preserves output order and avoids
      // re-matching a golden signal against more than one pipeline signal.
      const equivalent = await client.isEquivalent(signal.what, candidate.what);
      if (equivalent) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex >= 0) {
      const [goldenSignal] = remainingGolden.splice(matchIndex, 1);
      matched.push({ pipeline: signal, golden: goldenSignal });
    } else {
      extra.push(signal);
    }
  }

  return { matched, missed: remainingGolden, extra };
}

/**
 * Five hand-picked (pipeline text, golden text, expectedEquivalent) examples used
 * to calibrate a JudgeClient before trusting it on real golden data (spec §10:
 * "judge 先用 5 个人工判例校准").
 */
export const CALIBRATION_EXAMPLES: Array<{
  a: string;
  b: string;
  expectedEquivalent: boolean;
}> = [
  {
    a: "Use Bun instead of npm for package management.",
    b: "Decided to switch the project's package manager from npm to Bun.",
    expectedEquivalent: true,
  },
  {
    a: "Add retry logic with exponential backoff to the HTTP client.",
    b: "The HTTP client should retry failed requests using exponential backoff.",
    expectedEquivalent: true,
  },
  {
    a: "Always use conventional commits, never add AI co-author trailers.",
    b: "Commit messages must follow the conventional commits format.",
    expectedEquivalent: false, // golden is more specific (also bans AI trailers); not fully equivalent
  },
  {
    a: "Fixed a bug where the migration ran twice on cold start.",
    b: "Add retry logic with exponential backoff to the HTTP client.",
    expectedEquivalent: false,
  },
  {
    a: "Prefer TypeScript strict mode across the codebase.",
    b: "The team agreed to enable strict mode in tsconfig.",
    expectedEquivalent: true,
  },
];

/**
 * Run a JudgeClient against CALIBRATION_EXAMPLES and report how many of the 5
 * hand-labeled examples it got right. Callers should require a high pass rate
 * (e.g. 5/5 or 4/5) before trusting the client for real evaluation runs.
 */
export async function calibrateJudge(client: JudgeClient): Promise<{
  total: number;
  correct: number;
  failures: Array<{ a: string; b: string; expected: boolean; actual: boolean }>;
}> {
  const failures: Array<{ a: string; b: string; expected: boolean; actual: boolean }> = [];
  let correct = 0;

  for (const example of CALIBRATION_EXAMPLES) {
    // Calibration set is tiny (5 examples); sequential await is simplest and deterministic.
    const actual = await client.isEquivalent(example.a, example.b);
    if (actual === example.expectedEquivalent) {
      correct++;
    } else {
      failures.push({ a: example.a, b: example.b, expected: example.expectedEquivalent, actual });
    }
  }

  return { total: CALIBRATION_EXAMPLES.length, correct, failures };
}

const JUDGE_SYSTEM_PROMPT = `You are judging whether two short descriptions of the same *kind* of signal (both already confirmed to be the same type, e.g. both "decision" or both "task") describe the same underlying fact or action.

Answer with exactly one word: "yes" if they are semantically equivalent (same underlying decision/task/fact, allowing for paraphrase), or "no" if they describe different things, or if one is meaningfully broader/narrower/more specific than the other in a way that changes what should be recorded.

Do not explain your reasoning. Respond with only "yes" or "no".`;

/**
 * Build a JudgeClient backed by the existing LLMProvider abstraction (the same
 * one used by the extraction pipeline, configured for MiniMax elsewhere in
 * config). No new LLM dependency is introduced.
 */
export function createLLMJudgeClient(provider: LLMProvider): JudgeClient {
  return {
    async isEquivalent(a: string, b: string): Promise<boolean> {
      const response = await provider.chat(
        [
          { role: "system", content: JUDGE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Description A: ${a}\nDescription B: ${b}\n\nAre these semantically equivalent?`,
          },
        ],
        { temperature: 0, responseFormat: "text" },
      );
      return response.trim().toLowerCase().startsWith("yes");
    },
  };
}

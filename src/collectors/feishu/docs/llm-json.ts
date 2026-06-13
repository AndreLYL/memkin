export class LlmJsonParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmJsonParseError";
  }
}

/**
 * Robust parse of an LLM JSON response (spec §"LLM JSON robustness", steps 1-2):
 *  1. Try JSON.parse as-is.
 *  2. Strip markdown code fences, then extract the substring between the first
 *     `{` and last `}` and parse that.
 * Throws LlmJsonParseError if both fail. The caller (FullCardBuilder, Plan 2)
 * handles step 3 (retry LLM) and step 4 (degrade to pointer).
 */
export function parseLlmJson(output: string): Record<string, unknown> {
  try {
    return JSON.parse(output) as Record<string, unknown>;
  } catch {
    // fall through
  }

  const stripped = output.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    const candidate = stripped.slice(first, last + 1);
    try {
      return JSON.parse(candidate) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  throw new LlmJsonParseError(`Could not parse LLM JSON from output: ${output.slice(0, 120)}`);
}

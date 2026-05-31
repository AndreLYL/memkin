import type { ExtractionResult } from "./types.js";

export function isEmptyExtraction(result: ExtractionResult): boolean {
  return (
    result.entities.length === 0 &&
    result.timeline.length === 0 &&
    result.links.length === 0 &&
    result.decisions.length === 0 &&
    result.tasks.length === 0 &&
    result.discoveries.length === 0 &&
    result.knowledge.length === 0
  );
}

import type { RawMessage } from "../../../core/types.js";
import type { CursorStaging } from "../cursor-staging.js";
import type { SourceCheckpoint } from "../types.js";

export interface FeishuSource {
  readonly name: string;
  fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage>;
  healthCheck(): Promise<boolean>;
}

import type { RawMessage } from "../../../core/types";
import type { CursorStaging } from "../cursor-staging";
import type { SourceCheckpoint } from "../types";

export interface FeishuSource {
  readonly name: string;
  fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage>;
  healthCheck(): Promise<boolean>;
}

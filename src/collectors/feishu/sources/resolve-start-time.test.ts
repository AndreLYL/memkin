import { describe, expect, it, vi } from "vitest";
import { CursorStaging } from "../cursor-staging.js";
import type { SourceCheckpoint } from "../types.js";
import { MessageSource } from "./messages.js";

function makeCursorStaging(): CursorStaging {
  return new CursorStaging();
}

function makePaginateMock() {
  return vi.fn().mockReturnValue(
    (async function* () {
      // yields nothing — empty chat
    })(),
  );
}

describe("resolveStartTime with overrideSinceMs", () => {
  it("uses overrideSinceMs when it is earlier than checkpoint last_sync_at", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource({ paginate: paginateMock } as never, ["chat1"], {
      lookbackDays: 30,
      overrideSinceMs: 100_000,
    });
    // checkpoint has last_sync_at = 1_000_000 (much later than override)
    const checkpoint: SourceCheckpoint = { chat1: { last_sync_at: 1_000_000 } };

    for await (const _ of source.fetch(checkpoint, makeCursorStaging())) {
      /* drain */
    }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        // start_time = floor((overrideSinceMs - overlapMs) / 1000) = floor((100000 - 2000) / 1000) = 98
        start_time: "98",
      }),
    );
  });

  it("does NOT use overrideSinceMs when checkpoint is earlier", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource(
      { paginate: paginateMock } as never,
      ["chat1"],
      { lookbackDays: 30, overrideSinceMs: 2_000_000 }, // override is LATER than checkpoint
    );
    const checkpoint: SourceCheckpoint = { chat1: { last_sync_at: 500_000 } };

    for await (const _ of source.fetch(checkpoint, makeCursorStaging())) {
      /* drain */
    }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        // checkpoint wins: start_time = floor((500000 - 2000) / 1000) = 498
        start_time: "498",
      }),
    );
  });

  it("uses overrideSinceMs when there is no checkpoint", async () => {
    const paginateMock = makePaginateMock();
    const source = new MessageSource({ paginate: paginateMock } as never, ["chat1"], {
      lookbackDays: 30,
      overrideSinceMs: 300_000,
    });

    for await (const _ of source.fetch(null, makeCursorStaging())) {
      /* drain */
    }

    expect(paginateMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ start_time: "298" }), // (300000 - 2000) / 1000 = 298
    );
  });
});

/**
 * Periodic embedding sweep for the daemon.
 *
 * The capture pipeline writes content_chunks with embedding = NULL and nothing
 * in the scheduled path ever embedded them, so vector search silently degraded
 * to FTS-only for all auto-captured content (embeddings only happened via the
 * manual `memkin embed` CLI or POST /api/data/embed). This loop batch-embeds
 * stale chunks in the background.
 *
 * Design mirrors store/managed/recovery-loop.ts: a self-rescheduling
 * setTimeout, so sweeps are single-flight by construction — the next timer is
 * only registered after the current sweep resolves. Failures (e.g. missing
 * embedding credentials) back off exponentially up to maxIntervalMs and never
 * kill the loop. A full batch means a backlog is being drained, so the next
 * sweep runs after the much shorter drainDelayMs.
 */

export interface EmbedSweepTarget {
  embedStale(opts?: { limit?: number }): Promise<{ embedded: number; errors: number }>;
}

export interface EmbedSweepOptions {
  /** Base sweep interval in ms. Default: 300_000 (5 min) */
  intervalMs?: number;
  /** Backoff ceiling in ms. Default: 1_800_000 (30 min) */
  maxIntervalMs?: number;
  /** Max chunks per sweep, passed to embedStale. Default: 256 */
  batchLimit?: number;
  /** Delay before the next sweep when a full batch was embedded. Default: 5_000 */
  drainDelayMs?: number;
  /** Called after every sweep that did work (embedded or errors > 0). */
  onSweep?: (result: { embedded: number; errors: number }) => void;
  /** Called when embedStale throws. */
  onError?: (err: unknown, consecutiveFailures: number) => void;
}

export interface EmbedSweepHandle {
  stop(): void;
}

export function startEmbedSweep(
  target: EmbedSweepTarget,
  opts: EmbedSweepOptions = {},
): EmbedSweepHandle {
  const intervalMs = opts.intervalMs ?? 300_000;
  const maxIntervalMs = opts.maxIntervalMs ?? 1_800_000;
  const batchLimit = opts.batchLimit ?? 256;
  const drainDelayMs = opts.drainDelayMs ?? 5_000;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consecutiveFailures = 0;
  let draining = false;

  function currentDelay(): number {
    if (draining) return drainDelayMs;
    if (consecutiveFailures === 0) return intervalMs;
    const backoff = intervalMs * 2 ** consecutiveFailures;
    return Math.min(backoff, maxIntervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;

    try {
      const result = await target.embedStale({ limit: batchLimit });
      if (stopped) return;
      consecutiveFailures = 0;
      draining = result.embedded >= batchLimit;
      if (result.embedded > 0 || result.errors > 0) {
        opts.onSweep?.(result);
      }
    } catch (err: unknown) {
      if (stopped) return;
      draining = false;
      consecutiveFailures++;
      opts.onError?.(err, consecutiveFailures);
    }

    schedule();
  }

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(() => void tick(), currentDelay());
  }

  schedule();

  return {
    stop(): void {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

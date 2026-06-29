/**
 * Recovery loop for managed Postgres.
 *
 * Design: self-rescheduling setTimeout (NOT setInterval).
 *
 * Single-flight is inherent: the next setTimeout is only registered AFTER the
 * current `restartIfDown()` call resolves or rejects. This means two checks can
 * never overlap — if the async check takes longer than the nominal interval the
 * loop simply waits for it to finish before scheduling the next tick.
 *
 * Exponential backoff: on consecutive failures the delay doubles each time,
 * capped at `maxIntervalMs`. A success resets both the counter and the delay.
 *
 * onFatal: fired exactly once when `consecutiveFailures === maxConsecutiveFailures`.
 * The loop keeps running at the capped interval so Postgres can still recover.
 */

export interface RecoveryTarget {
  restartIfDown(): Promise<boolean>;
}

export interface RecoveryLoopOptions {
  /** Base check interval in ms. Default: 3000 */
  intervalMs?: number;
  /** Backoff ceiling in ms. Default: 30000 */
  maxIntervalMs?: number;
  /** Number of consecutive failures before onFatal is called. Default: 5 */
  maxConsecutiveFailures?: number;
  /** Called when restartIfDown() returns true (pg was restarted). */
  onRestart?: (info: { attempt: number }) => void;
  /** Called on every failure with the current consecutive-failure count. */
  onError?: (err: unknown, consecutiveFailures: number) => void;
  /** Called exactly once when consecutiveFailures reaches the threshold. */
  onFatal?: (consecutiveFailures: number) => void;
}

export interface RecoveryLoopHandle {
  stop(): void;
  readonly consecutiveFailures: number;
}

export function startRecoveryLoop(
  target: RecoveryTarget,
  opts: RecoveryLoopOptions = {},
): RecoveryLoopHandle {
  const intervalMs = opts.intervalMs ?? 3000;
  const maxIntervalMs = opts.maxIntervalMs ?? 30_000;
  const maxConsecutiveFailures = opts.maxConsecutiveFailures ?? 5;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let consecutiveFailures = 0;
  let fatalFired = false;
  let restartAttempt = 0;

  function currentDelay(): number {
    if (consecutiveFailures === 0) return intervalMs;
    // 2^(consecutiveFailures-1) * intervalMs, capped
    const backoff = intervalMs * Math.pow(2, consecutiveFailures - 1);
    return Math.min(backoff, maxIntervalMs);
  }

  async function tick(): Promise<void> {
    if (stopped) return;

    try {
      const restarted = await target.restartIfDown();
      if (stopped) return;

      // Success path — reset state
      consecutiveFailures = 0;
      fatalFired = false;

      if (restarted) {
        restartAttempt++;
        opts.onRestart?.({ attempt: restartAttempt });
      }
    } catch (err: unknown) {
      if (stopped) return;

      consecutiveFailures++;
      opts.onError?.(err, consecutiveFailures);

      if (
        consecutiveFailures === maxConsecutiveFailures &&
        !fatalFired
      ) {
        fatalFired = true;
        opts.onFatal?.(consecutiveFailures);
      }
    }

    // Self-reschedule — only after the check completes (single-flight guarantee)
    if (!stopped) {
      timer = setTimeout(() => {
        tick().catch(() => {
          // tick() never rejects (errors are caught inside), but silence any
          // unexpected leak to avoid unhandled-rejection warnings.
        });
      }, currentDelay());
    }
  }

  // Kick off the first tick after one base interval
  timer = setTimeout(() => {
    tick().catch(() => {
      /* see above */
    });
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
    get consecutiveFailures() {
      return consecutiveFailures;
    },
  };
}

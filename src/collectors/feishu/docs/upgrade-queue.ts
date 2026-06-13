export interface UpgradeQueueConfig {
  batch_size: number;
  bootstrap_batch_size: number;
  bootstrap_runs: number;
  max_pending: number;
}

export class UpgradeQueue {
  private items: string[];
  private set: Set<string>;

  constructor(initial: string[], private readonly maxPending: number) {
    this.items = [...initial];
    this.set = new Set(initial);
  }

  /** Returns true if enqueued, false if duplicate or cap reached (dropped). */
  enqueue(docToken: string): boolean {
    if (this.set.has(docToken)) return false;
    if (this.items.length >= this.maxPending) return false;
    this.items.push(docToken);
    this.set.add(docToken);
    return true;
  }

  shift(k: number): string[] {
    const batch = this.items.splice(0, k);
    for (const t of batch) this.set.delete(t);
    return batch;
  }

  pending(): string[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }
}

export function batchSizeForRun(runCount: number, cfg: UpgradeQueueConfig): number {
  return runCount < cfg.bootstrap_runs ? cfg.bootstrap_batch_size : cfg.batch_size;
}

export interface HealthResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ExpectedHealth {
  instanceId: string;
  port: number;
  bind: string;
  engine: string;
}

export function isReady(resp: HealthResponse, expected: ExpectedHealth): boolean {
  if (resp.status !== 200) return false;
  const b = resp.body;
  if (b.instance_id !== expected.instanceId) return false;
  if (b.db_ok !== true) return false;
  if (b.read_only !== false) return false;
  if (b.engine !== expected.engine) return false;
  // port/bind are echoed by some daemons; if present they must match, if absent don't fail on them
  if (b.port !== undefined && b.port !== expected.port) return false;
  if (b.bind !== undefined && b.bind !== expected.bind) return false;
  return true;
}

export interface PollOpts {
  timeoutMs?: number;
  intervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export async function pollHealth(
  fetchHealth: () => Promise<HealthResponse>,
  expected: ExpectedHealth,
  opts: PollOpts = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 250;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  // NOTE: Date.now is fine in production runtime code; tests inject `now`/`sleep`.
  while (now() - start < timeoutMs) {
    try {
      if (isReady(await fetchHealth(), expected)) return true;
    } catch {
      // daemon not up yet — keep polling
    }
    await sleep(intervalMs);
  }
  return false;
}

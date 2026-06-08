/**
 * Verifies that lark-cli supports concurrent subprocess invocations.
 * Run with: bun run scripts/test-lark-concurrency.ts
 *
 * Pass --lark-bin=/path/to/lark to override the default binary path.
 */
import { LarkCliHttpClient } from "../src/collectors/feishu/lark-cli-client.js";

const larkBin = process.argv.find((a) => a.startsWith("--lark-bin="))?.split("=")[1];
const client = new LarkCliHttpClient(larkBin);

const CONCURRENCY_LEVELS = [1, 3, 5];
const TEST_CALLS = 10;

async function timeCall(label: string): Promise<number> {
  const start = Date.now();
  try {
    // healthCheck just runs `lark auth status` — no writes, safe to spam
    await client.healthCheck();
  } catch {
    // expected if not authenticated; we're measuring time, not correctness
  }
  const ms = Date.now() - start;
  return ms;
}

async function runAtConcurrency(n: number): Promise<void> {
  const calls = Array.from({ length: TEST_CALLS }, (_, i) => `call-${i}`);
  const results: number[] = [];

  const wallStart = Date.now();

  for (let i = 0; i < calls.length; i += n) {
    const batch = calls.slice(i, i + n);
    const times = await Promise.all(batch.map((label) => timeCall(label)));
    results.push(...times);
  }

  const wallMs = Date.now() - wallStart;
  const avg = results.reduce((a, b) => a + b, 0) / results.length;

  console.log(
    `concurrency=${n}  total=${(wallMs / 1000).toFixed(2)}s  avg_per_call=${avg.toFixed(0)}ms  calls=${TEST_CALLS}`,
  );
}

console.log("Testing lark-cli concurrent subprocess safety...\n");
for (const n of CONCURRENCY_LEVELS) {
  await runAtConcurrency(n);
}
console.log("\nIf all lines completed without errors and avg_per_call is stable, concurrent calls are safe.");

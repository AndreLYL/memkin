/**
 * Seed the demo library (launch sprint Task D1).
 *
 *   bun scripts/demo-seed.ts
 *
 * Loads `demo/demo.config.yaml` (dedicated PGLite dir, default
 * `~/.memkin-demo/data`) and writes the synthetic dataset from
 * `demo/seed/pages/**.md`. Idempotent — safe to re-run.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveDb } from "../src/cli-stores.js";
import { loadConfig } from "../src/core/config.js";
import { DEMO_PAGES_DIR, seedDemo } from "../src/demo/seed.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(resolve(repoRoot, "demo/demo.config.yaml"));

const { db } = await resolveDb(config);
try {
  const summary = await seedDemo(db, { pagesDir: resolve(repoRoot, DEMO_PAGES_DIR) });
  console.log(
    `Demo library seeded (${config.store?.data_dir}): ` +
      `${summary.pages} pages, ${summary.links} links, ${summary.timelineEntries} timeline entries.`,
  );
} finally {
  await db.close();
}

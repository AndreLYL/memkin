import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Runtime assets (schema.sql + extractor prompts) are embedded as string constants via
// scripts/gen-embedded-assets.mjs, so there is nothing to copy here — this step just makes
// the built CLI directly executable.

const distCli = resolve(process.cwd(), "dist", "cli.js");
const binCli = resolve(process.cwd(), "bin", "memoark.mjs");
const shebang = "#!/usr/bin/env node";

if (!existsSync(distCli)) {
  throw new Error(`Build output not found: ${distCli}`);
}

const content = readFileSync(distCli, "utf-8");
if (!content.startsWith("#!")) {
  writeFileSync(distCli, `${shebang}\n${content}`, "utf-8");
}

if (process.platform !== "win32") {
  chmodSync(distCli, 0o755);
  if (existsSync(binCli)) {
    chmodSync(binCli, 0o755);
  }
}

#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distCli = resolve(projectRoot, "dist", "cli.js");
const srcCli = resolve(projectRoot, "src", "cli.ts");
const args = process.argv.slice(2);

// dist exists: prefer Bun when available, otherwise run with the current Node process.
if (existsSync(distCli)) {
  let result = spawnSync("bun", [distCli, ...args], { stdio: "inherit" });
  if (result.error) {
    result = spawnSync(process.execPath, [distCli, ...args], { stdio: "inherit" });
  }
  process.exit(result.status ?? (result.error ? 1 : 0));
} else if (existsSync(srcCli)) {
  const candidates = [
    { command: "bun", args: [srcCli, ...args] },
    { command: "tsx", args: [srcCli, ...args] },
    { command: "npx", args: ["tsx", srcCli, ...args] },
  ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, { stdio: "inherit" });
    if (result.error) {
      continue;
    }
    process.exit(result.status ?? 0);
  }

  console.error("Error: No runtime found to execute Memoark from source.");
  console.error("Install Bun, install tsx, or run npm run build before using this binary.");
  process.exit(1);
} else {
  console.error("Error: Cannot find Memoark CLI entrypoint.");
  process.exit(1);
}

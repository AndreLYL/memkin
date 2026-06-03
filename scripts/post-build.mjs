import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distCli = resolve(process.cwd(), "dist", "cli.js");
const binCli = resolve(process.cwd(), "bin", "memoark.mjs");
const srcStoreSchema = resolve(process.cwd(), "src", "store", "schema.sql");
const distStoreDir = resolve(process.cwd(), "dist", "store");
const distStoreSchema = resolve(distStoreDir, "schema.sql");
const srcPromptsDir = resolve(process.cwd(), "src", "extractors", "prompts");
const distPromptsDir = resolve(process.cwd(), "dist", "extractors", "prompts");
const shebang = "#!/usr/bin/env node";

if (!existsSync(distCli)) {
  throw new Error(`Build output not found: ${distCli}`);
}

const content = readFileSync(distCli, "utf-8");
if (!content.startsWith("#!")) {
  writeFileSync(distCli, `${shebang}\n${content}`, "utf-8");
}

mkdirSync(distStoreDir, { recursive: true });
cpSync(srcStoreSchema, distStoreSchema);
cpSync(srcPromptsDir, distPromptsDir, { recursive: true });

if (process.platform !== "win32") {
  chmodSync(distCli, 0o755);
  if (existsSync(binCli)) {
    chmodSync(binCli, 0o755);
  }
}

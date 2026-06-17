import { execSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const triple = execSync("rustc -Vv")
  .toString()
  .split("\n")
  .find((l) => l.startsWith("host:"))
  .split(" ")[1]
  .trim();
const ext = triple.includes("windows") ? ".exe" : "";
mkdirSync(join(root, "src-tauri/binaries"), { recursive: true });
mkdirSync(join(root, "src-tauri/assets"), { recursive: true });
execSync(`bun build --compile src/cli.ts --outfile src-tauri/binaries/memoark-${triple}${ext}`, {
  stdio: "inherit",
  env: process.env,
});
const dist = join(root, "node_modules/@electric-sql/pglite/dist");
for (const f of ["pglite.wasm", "initdb.wasm", "pglite.data", "vector.tar.gz"]) {
  cpSync(join(dist, f), join(root, "src-tauri/assets", f));
}
console.log(`sidecar: src-tauri/binaries/memoark-${triple}${ext}; assets copied`);

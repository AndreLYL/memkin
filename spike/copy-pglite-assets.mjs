import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pgDist = join(here, "..", "node_modules", "@electric-sql", "pglite", "dist");
const out = join(here, "assets");
await mkdir(out, { recursive: true });
for (const f of ["pglite.wasm", "initdb.wasm", "pglite.data", "vector.tar.gz"]) {
  await cp(join(pgDist, f), join(out, f));
  console.log("copied", f);
}

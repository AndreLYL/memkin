import { readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { PGlite } from "@electric-sql/pglite";

const baseDir = import.meta.url.includes("$bunfs") ? dirname(process.execPath) : import.meta.dir;
const asset = (n: string) => join(baseDir, "assets", n);

async function makeOpts() {
  const pgliteWasmModule = await WebAssembly.compile(await readFile(asset("pglite.wasm")));
  const initdbWasmModule = await WebAssembly.compile(await readFile(asset("initdb.wasm")));
  const fsBundle = new Blob([await readFile(asset("pglite.data"))]);
  const vectorBundleURL = new URL("file://" + asset("vector.tar.gz"));
  const vector = {
    name: "pgvector",
    setup: async (_pg: unknown, opts: unknown) => ({ emscriptenOpts: opts, bundlePath: vectorBundleURL }),
  };
  return { pgliteWasmModule, initdbWasmModule, fsBundle, extensions: { vector } };
}

async function runOnce(label: string, dataDir?: string) {
  const pg = new PGlite({ ...(await makeOpts()), ...(dataDir ? { dataDir } : {}) });
  await pg.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  const r = await pg.query<{ v: string }>("SELECT '[1,2,3]'::vector AS v;");
  console.log(`VECTOR_OK[${label}]:`, r.rows[0]?.v);
  await pg.close();
}

async function main() {
  await runOnce("memory");
  const dir = join(tmpdir(), "memoark-spike-db");
  await rm(dir, { recursive: true, force: true });
  await runOnce("dataDir", dir);
  console.log("SPIKE_A_PASS");
}
main().catch((e) => { console.error("SPIKE_A_FAIL:", e?.message ?? e); process.exit(1); });

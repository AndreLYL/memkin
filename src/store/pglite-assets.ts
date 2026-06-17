import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PGliteOptions } from "@electric-sql/pglite";
import { vector as stockVector } from "@electric-sql/pglite/vector";

export function isCompiledBinary(metaUrl: string = import.meta.url): boolean {
  return metaUrl.includes("$bunfs");
}

export interface AssetDirInputs {
  override?: string; // Tauri resource dir，经 --pglite-assets 传入，优先级最高
  execDir?: string; // compiled 时 = dirname(process.execPath)
  nodeModulesDir: string; // dev 时 = node_modules/@electric-sql/pglite/dist
}

/** 纯函数：决定 PGLite 资产所在目录。override > execDir/assets > nodeModulesDir。 */
export function resolveAssetDir(inputs: AssetDirInputs): string {
  if (inputs.override) return inputs.override;
  if (inputs.execDir) return join(inputs.execDir, "assets");
  return inputs.nodeModulesDir;
}

/** compiled 模式下构造显式 blobs option；dev 模式返回 stock vector。 */
export async function buildPGliteOptions(
  dataDir: string | undefined,
  opts: { compiled?: boolean; assetsOverride?: string } = {},
): Promise<PGliteOptions> {
  const compiled = opts.compiled ?? isCompiledBinary();
  if (!compiled) {
    return { dataDir, extensions: { vector: stockVector } };
  }
  const nodeModulesDir = ""; // compiled 不走这支
  const execDir = dirname(process.execPath);
  const assetDir = resolveAssetDir({ override: opts.assetsOverride, execDir, nodeModulesDir });
  const asset = (n: string) => join(assetDir, n);
  const pgliteWasmModule = await WebAssembly.compile(await readFile(asset("pglite.wasm")));
  const initdbWasmModule = await WebAssembly.compile(await readFile(asset("initdb.wasm")));
  const fsBundle = new Blob([await readFile(asset("pglite.data"))]);
  const vectorBundleURL = new URL("file://" + asset("vector.tar.gz"));
  const vector = {
    name: "pgvector",
    setup: async (_pg: unknown, em: unknown) => ({ emscriptenOpts: em, bundlePath: vectorBundleURL }),
  };
  return { dataDir, pgliteWasmModule, initdbWasmModule, fsBundle, extensions: { vector } };
}

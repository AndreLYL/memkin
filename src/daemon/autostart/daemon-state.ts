import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DaemonState {
  instance_id: string;
  config_path: string;
  raw_yaml_hash: string;
  serving_subset_hash: string;
  url: string;
  argv: string[];
}

export interface ServingSubset {
  bind: string;
  port: number;
  readOnly: boolean;
  hosts: string[];
}

export function writeDaemonState(dir: string, state: DaemonState): void {
  const filePath = join(dir, "daemon.json");
  const tmpPath = join(dir, "daemon.json.tmp");
  writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmpPath, filePath);
}

export function readDaemonState(dir: string): DaemonState | null {
  const filePath = join(dir, "daemon.json");
  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as DaemonState;
  } catch {
    return null;
  }
}

export function rawYamlHash(filePath: string): string {
  const bytes = readFileSync(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

export function servingSubsetHash(subset: ServingSubset): string {
  const normalized: ServingSubset = {
    ...subset,
    hosts: [...subset.hosts].sort(),
  };
  const sorted = Object.fromEntries(
    Object.keys(normalized)
      .sort()
      .map((k) => [k, normalized[k as keyof ServingSubset]]),
  );
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

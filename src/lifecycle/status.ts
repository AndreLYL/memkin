import type { DaemonState } from "../daemon/autostart/daemon-state.js";

export interface HealthLite {
  status: number;
  body: Record<string, unknown>;
}

export interface ComputeStatusDeps {
  stored: Pick<DaemonState, "raw_yaml_hash" | "serving_subset_hash" | "config_path" | "url"> | null;
  /** rawYamlHash(stored.config_path) — caller computes; no secret resolution */
  currentRawHash: string | null;
  currentServingHash: string | null;
  /** live /health response, or null if unreachable */
  health: HealthLite | null;
}

export interface StatusReport {
  running: boolean;
  url?: string;
  pid?: number;
  engine?: string;
  configPath?: string;
  drift: {
    configChanged: boolean;
    needsReup: boolean;
    restartedOntoEditedConfig: boolean;
  };
}

export function computeStatus(deps: ComputeStatusDeps): StatusReport {
  const { stored, currentRawHash, currentServingHash, health } = deps;

  const running = !!health && health.status === 200;
  const body = health?.body ?? {};

  const configChanged =
    !!stored && currentRawHash !== null && currentRawHash !== stored.raw_yaml_hash;

  const needsReup =
    !!stored && currentServingHash !== null && currentServingHash !== stored.serving_subset_hash;

  // The daemon echoes the config hash it actually loaded; if it differs from stored desired hash,
  // it restarted onto edited YAML.
  const loaded = typeof body.loaded_config_hash === "string" ? body.loaded_config_hash : null;
  const restartedOntoEditedConfig = !!stored && loaded !== null && loaded !== stored.raw_yaml_hash;

  return {
    running,
    url: stored?.url,
    pid: typeof body.pid === "number" ? body.pid : undefined,
    engine: typeof body.engine === "string" ? body.engine : undefined,
    configPath: stored?.config_path,
    drift: { configChanged, needsReup, restartedOntoEditedConfig },
  };
}

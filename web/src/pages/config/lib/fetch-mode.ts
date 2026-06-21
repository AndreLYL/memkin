import type { WizardConfig } from "../../../api/config.js";

export type FetchMode = "autonomous" | "curated";

export function fetchModeFromConfig(config: WizardConfig): FetchMode {
  return config.sources?.feishu?.auto_include_new_groups ? "autonomous" : "curated";
}

export function applyFetchMode(config: WizardConfig, mode: FetchMode): Partial<WizardConfig> {
  const feishu = config.sources?.feishu ?? {};
  return {
    sources: {
      ...config.sources,
      feishu: { ...feishu, auto_include_new_groups: mode === "autonomous" },
    },
  };
}

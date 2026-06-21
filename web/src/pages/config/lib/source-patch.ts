import type { WizardConfig } from "../../../api/config.js";

export function toggleTopSource(
  config: WizardConfig,
  id: string,
  on: boolean
): Partial<WizardConfig> {
  const sources = config.sources ?? {};
  const existing = ((sources as Record<string, unknown>)[id] ?? {}) as Record<string, unknown>;
  return {
    sources: {
      ...sources,
      [id]: { ...existing, enabled: on },
    } as WizardConfig["sources"],
  };
}

export function toggleFeishuSubSource(
  config: WizardConfig,
  key: string,
  on: boolean
): Partial<WizardConfig> {
  const sources = config.sources ?? {};
  const feishu = sources.feishu ?? {};
  const sub = (feishu.sources ?? {}) as Record<string, boolean>;
  return {
    sources: {
      ...sources,
      feishu: {
        ...feishu,
        sources: { ...sub, [key]: on },
      },
    } as WizardConfig["sources"],
  };
}

export function setChatIds(
  config: WizardConfig,
  ids: string[]
): Partial<WizardConfig> {
  const sources = config.sources ?? {};
  const feishu = sources.feishu ?? {};
  return {
    sources: {
      ...sources,
      feishu: {
        ...feishu,
        chat_ids: ids,
      },
    } as WizardConfig["sources"],
  };
}

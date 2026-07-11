import { describe, expect, it } from "vitest";
import type { PartialConfig } from "../setup/validate-config.js";
import { validateDraft } from "./validation.js";

const draft = (feishu: NonNullable<PartialConfig["sources"]>["feishu"]): PartialConfig => ({
  llm: { provider: "anthropic", model: "claude" },
  sources: { feishu },
});

const appIdError = (paths: { path: string; message: string }[]) =>
  paths.find((d) => d.path === "sources.feishu.app_id");

describe("validateDraft — Feishu credentials", () => {
  it("does not flag missing app_id for a user-only mail config", () => {
    const diags = validateDraft(
      draft({ enabled: true, sources: { mail: { enabled: true } } } as never),
    );
    expect(appIdError(diags)).toBeUndefined();
  });

  it("does not flag missing app_id for message_search / docs only", () => {
    const diags = validateDraft(
      draft({
        enabled: true,
        sources: { message_search: { enabled: true }, docs: { enabled: true } },
      } as never),
    );
    expect(appIdError(diags)).toBeUndefined();
  });

  it("flags missing app_id when calendar (bot-scoped) is enabled", () => {
    const diags = validateDraft(
      draft({ enabled: true, sources: { calendar: { enabled: true } } } as never),
    );
    const err = appIdError(diags);
    expect(err?.severity).toBe("error");
    expect(err?.message).toBe(
      "Feishu App ID is required for bot-scoped sources (messages, calendar, tasks, dm)",
    );
  });

  it("does not flag when bot-scoped source has credentials", () => {
    const diags = validateDraft(
      draft({
        enabled: true,
        app_id: "cli_x",
        app_secret: "s",
        sources: { messages: { enabled: true } },
      } as never),
    );
    expect(appIdError(diags)).toBeUndefined();
  });
});

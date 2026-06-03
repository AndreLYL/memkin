import { describe, expect, it, vi } from "vitest";
import { createDefaultConfigDocument, updateDraft } from "../../src/config-center/document.js";
import { createInitialState } from "../../src/config-center/reducer.js";
import { autosaveBeforeExit, type ConfigCenterDispatch } from "../../src/config-center/tui/app.js";

describe("config-center app exit", () => {
  it("exits immediately when there are no unsaved changes", async () => {
    const state = createInitialState(createDefaultConfigDocument("/tmp/memoark.yaml"));
    const save = vi.fn();
    const onExit = vi.fn();
    const dispatch = vi.fn<ConfigCenterDispatch>();

    await autosaveBeforeExit({ state, save, onExit, dispatch });

    expect(save).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("saves dirty config before exiting", async () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const updated = updateDraft(doc, "llm.model", "gpt-test");
    const state = { ...createInitialState(updated), doc: updated, dirty: true };
    const save = vi.fn().mockResolvedValue(undefined);
    const onExit = vi.fn();
    const dispatch = vi.fn<ConfigCenterDispatch>();

    await autosaveBeforeExit({ state, save, onExit, dispatch });

    expect(save).toHaveBeenCalledWith(updated);
    expect(dispatch).toHaveBeenCalledWith({ type: "saveSucceeded" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("keeps the app open and reports an error when autosave fails", async () => {
    const doc = createDefaultConfigDocument("/tmp/memoark.yaml");
    const updated = updateDraft(doc, "llm.model", "gpt-test");
    const state = { ...createInitialState(updated), doc: updated, dirty: true };
    const save = vi.fn().mockRejectedValue(new Error("disk full"));
    const onExit = vi.fn();
    const dispatch = vi.fn<ConfigCenterDispatch>();

    await autosaveBeforeExit({ state, save, onExit, dispatch });

    expect(save).toHaveBeenCalledWith(updated);
    expect(dispatch).toHaveBeenCalledWith({ type: "setStatus", message: "disk full" });
    expect(onExit).not.toHaveBeenCalled();
  });
});

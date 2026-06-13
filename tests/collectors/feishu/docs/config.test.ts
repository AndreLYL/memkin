import { describe, expect, test } from "vitest";
import { normalizeDocsConfig } from "../../../../src/collectors/feishu/docs/config";

describe("normalizeDocsConfig", () => {
  test("fills defaults for an empty docs block", () => {
    const c = normalizeDocsConfig({ enabled: true });
    expect(c.my_space.enabled).toBe(true);
    expect(c.my_space.max_depth).toBe(10);
    expect(c.wiki.enabled).toBe(true);
    expect(c.triggers.self_edit).toBe(true);
    expect(c.triggers.recent_window_days).toBe(null);
    expect(c.upgrade_queue.batch_size).toBe(20);
    expect(c.upgrade_queue.bootstrap_batch_size).toBe(50);
    expect(c.upgrade_queue.bootstrap_runs).toBe(5);
    expect(c.upgrade_queue.max_pending).toBe(5000);
    expect(c.gate.min_content_chars).toBe(200);
    expect(c.refresh.on_hash_change).toBe(true);
  });

  test("preserves explicit overrides", () => {
    const c = normalizeDocsConfig({
      enabled: true,
      triggers: { recent_window_days: 90, important_folders: ["fld_x"] },
      upgrade_queue: { batch_size: 5 },
    });
    expect(c.triggers.recent_window_days).toBe(90);
    expect(c.triggers.important_folders).toEqual(["fld_x"]);
    expect(c.upgrade_queue.batch_size).toBe(5);
    expect(c.upgrade_queue.bootstrap_batch_size).toBe(50); // still defaulted
  });
});

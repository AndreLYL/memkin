import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AlertWriter } from "../../src/daemon/alerts.js";
import { Database } from "../../src/store/database.js";
import { PageStore } from "../../src/store/pages.js";

describe("AlertWriter", () => {
  let pageStore: PageStore;
  let db: Database;

  beforeEach(async () => {
    db = await Database.create();
    pageStore = new PageStore(db.executor);
  });

  afterEach(async () => {
    await db?.close?.();
  });

  it("writes alert page when sources have alerts", async () => {
    const writer = new AlertWriter(pageStore);
    await writer.update([
      {
        source_id: "feishu",
        state: {
          last_run_at: Date.now(),
          last_result: "failed",
          last_error: "API 429 rate limited",
          consecutive_failures: 3,
          consecutive_partials: 0,
        },
      },
    ]);

    const page = await pageStore.getPage("system/alerts");
    expect(page).not.toBeNull();
    expect(page?.compiled_truth).toContain("feishu");
    expect(page?.compiled_truth).toContain("API 429 rate limited");
    expect(page?.compiled_truth).toContain("3");
  });

  it("deletes alert page when no sources have alerts", async () => {
    const writer = new AlertWriter(pageStore);

    await writer.update([
      {
        source_id: "feishu",
        state: {
          last_run_at: Date.now(),
          last_result: "failed",
          last_error: "err",
          consecutive_failures: 3,
          consecutive_partials: 0,
        },
      },
    ]);
    expect(await pageStore.getPage("system/alerts")).not.toBeNull();

    await writer.update([]);
    expect(await pageStore.getPage("system/alerts")).toBeNull();
  });

  it("includes multiple sources in one alert page", async () => {
    const writer = new AlertWriter(pageStore);
    await writer.update([
      {
        source_id: "feishu",
        state: {
          last_run_at: Date.now(),
          last_result: "failed",
          last_error: "timeout",
          consecutive_failures: 5,
          consecutive_partials: 0,
        },
      },
      {
        source_id: "codex",
        state: {
          last_run_at: Date.now(),
          last_result: "partial",
          last_error: null,
          consecutive_failures: 0,
          consecutive_partials: 7,
        },
      },
    ]);

    const page = await pageStore.getPage("system/alerts");
    expect(page?.compiled_truth).toContain("feishu");
    expect(page?.compiled_truth).toContain("codex");
  });
});

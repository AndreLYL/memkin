import { Hono } from "hono";
import { createFeishuCollector } from "../collectors/feishu/index.js";
import { loadConfig } from "../core/config.js";
import { IdentityResolver } from "../core/identity-resolver.js";
import { runPipeline } from "../core/pipeline.js";
import { buildPipelineConfig } from "../core/pipeline-factory.js";
import { createLLMProvider } from "../extractors/providers/index.js";
import type { StoreContext } from "./api.js";
import type { BackfillJob, BackfillSourceType, RunForSourceFn } from "./backfill-job.js";
import { BackfillJob as BackfillJobClass } from "./backfill-job.js";

const COVERAGE_SQL = `
SELECT
  (floor(extract(epoch from to_date(left(date, 10), 'YYYY-MM-DD')) / (7 * 86400))
   * 7 * 86400 * 1000)::bigint AS week_start_ms,
  count(*)::int AS count
FROM timeline_entries
WHERE source = 'feishu'
  AND date ~ '^\\d{4}-\\d{2}-\\d{2}'
  AND date >= to_char(now() - interval '104 weeks', 'YYYY-MM-DD')
GROUP BY week_start_ms
ORDER BY week_start_ms
`;

export function createBackfillRoutes(job: BackfillJob, stores: StoreContext): Hono {
  const app = new Hono();

  app.get("/api/backfill/status", (c) => {
    return c.json(job.getStatus());
  });

  app.post("/api/backfill/start", async (c) => {
    const body = (await c.req.json<unknown>().catch(() => ({}))) as {
      since_ms?: unknown;
      source_types?: unknown;
    };

    if (typeof body.since_ms !== "number") {
      return c.json({ error: "Missing or invalid required parameter: since_ms (number)" }, 400);
    }

    if (!Array.isArray(body.source_types) || body.source_types.length === 0) {
      return c.json(
        { error: "Missing or invalid required parameter: source_types (non-empty array)" },
        400,
      );
    }

    const status = job.getStatus();
    if (status.state === "running") {
      return c.json({ error: "Backfill job is already running" }, 409);
    }

    job.start({
      since_ms: body.since_ms,
      source_types: body.source_types as BackfillSourceType[],
    });

    return c.json({ started: true }, 202);
  });

  app.post("/api/backfill/cancel", (c) => {
    job.cancel();
    return c.json({ ok: true });
  });

  app.post("/api/backfill/reset", (c) => {
    job.reset();
    return c.json({ ok: true });
  });

  app.get("/api/backfill/coverage", async (c) => {
    const result = await stores.db.pg.query(COVERAGE_SQL);
    const buckets = (result.rows as Array<{ week_start_ms: string; count: number }>).map((row) => ({
      week_start: Number(row.week_start_ms),
      count: row.count,
    }));
    return c.json({ buckets });
  });

  return app;
}

export function buildRunForSource(stores: StoreContext, configPath: string): RunForSourceFn {
  return async (sourceType: BackfillSourceType, sinceMs: number) => {
    const config = loadConfig(configPath);

    if (!config.sources.feishu) {
      return {
        fatal: true,
        error: "Feishu source not configured",
        totalMessages: 0,
        totalBlocks: 0,
        okBlocks: 0,
        skippedBlocks: 0,
        failedBlocks: 0,
        okMessages: [],
        skippedMessages: [],
        failedMessages: [],
        warnings: [],
      };
    }

    const feishuConfig = config.sources.feishu;

    // Build a temp feishu config with all 4 backfill sub-sources disabled,
    // then enable only the target source with override_since_ms
    const tempFeishuConfig = {
      ...feishuConfig,
      sources: {
        // Keep non-backfill sources from original config
        docs: feishuConfig.sources.docs,
        tasks: feishuConfig.sources.tasks,
        calendar: feishuConfig.sources.calendar,
        // Disable all 4 backfill sources by default
        messages: { enabled: false, chat_ids: feishuConfig.sources.messages?.chat_ids ?? [] },
        dm: { enabled: false },
        mail: { enabled: false },
        message_search: { enabled: false },
        // Enable the target source
        [sourceType]: {
          ...(feishuConfig.sources[sourceType as keyof typeof feishuConfig.sources] ?? {}),
          enabled: true,
          override_since_ms: sinceMs,
        },
      },
    };

    const collector = createFeishuCollector(tempFeishuConfig as never);

    const pipelineConfig = buildPipelineConfig(config, config.store.data_dir);

    const llmConfig = { ...config.llm };
    if (!llmConfig.api_key) {
      llmConfig.api_key = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    }

    const provider = createLLMProvider(llmConfig);

    const identityResolver = new IdentityResolver(stores.db.pg);

    return runPipeline(pipelineConfig, {
      source: collector,
      provider,
      format: "json",
      adapter: "store",
      stores: stores as never,
      identityResolver,
    });
  };
}

export function createDefaultBackfillRoutes(stores: StoreContext, configPath: string): Hono {
  const runForSource = buildRunForSource(stores, configPath);
  const job = new BackfillJobClass(runForSource);
  return createBackfillRoutes(job, stores);
}

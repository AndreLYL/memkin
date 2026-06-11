import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Hono } from "hono";
import { parse } from "yaml";
import { LarkCliHttpClient } from "../collectors/feishu/lark-cli-client.js";
import { maskSecret } from "../config-center/secrets.js";
import { validateDraft } from "../config-center/validation.js";
import { testEmbeddingConnection, testLLMConnection } from "../setup/connection-tests.js";
import { generateConfigYaml } from "../setup/generate-config.js";
import type { PartialConfig } from "../setup/validate-config.js";

export interface ConfigRoutesOpts {
  configPath: string;
  larkBin?: string;
  onSetupComplete?: () => void;
}

export function createConfigRoutes(opts: ConfigRoutesOpts): Hono {
  const app = new Hono();

  app.get("/api/config", (c) => {
    if (!existsSync(opts.configPath)) return c.json({});
    const raw = readFileSync(opts.configPath, "utf-8");
    const parsed = (parse(raw) ?? {}) as PartialConfig;
    if (parsed.llm?.api_key) parsed.llm.api_key = maskSecret(parsed.llm.api_key);
    if (parsed.embedding?.api_key) parsed.embedding.api_key = maskSecret(parsed.embedding.api_key);
    if (parsed.sources?.feishu?.app_secret) {
      parsed.sources.feishu.app_secret = maskSecret(parsed.sources.feishu.app_secret);
    }
    return c.json(parsed);
  });

  app.post("/api/config", async (c) => {
    const body = await c.req.json<PartialConfig>();

    const isMasked = (v: string | undefined): boolean =>
      typeof v === "string" && v.includes("****");

    if (
      isMasked(body.llm?.api_key) ||
      isMasked(body.embedding?.api_key) ||
      isMasked(body.sources?.feishu?.app_secret)
    ) {
      let existing: PartialConfig = {};
      if (existsSync(opts.configPath)) {
        existing = (parse(readFileSync(opts.configPath, "utf-8")) ?? {}) as PartialConfig;
      }
      if (isMasked(body.llm?.api_key) && body.llm) {
        body.llm.api_key = existing.llm?.api_key ?? body.llm.api_key;
      }
      if (isMasked(body.embedding?.api_key) && body.embedding) {
        body.embedding.api_key = existing.embedding?.api_key ?? body.embedding.api_key;
      }
      if (isMasked(body.sources?.feishu?.app_secret) && body.sources?.feishu) {
        body.sources.feishu.app_secret =
          existing.sources?.feishu?.app_secret ?? body.sources.feishu.app_secret;
      }
    }

    const diagnostics = validateDraft(body);
    if (diagnostics.some((d) => d.severity === "error")) {
      return c.json({ ok: false, diagnostics }, 422);
    }
    const yaml = generateConfigYaml(body);
    mkdirSync(dirname(opts.configPath), { recursive: true });
    writeFileSync(opts.configPath, yaml, "utf-8");
    return c.json({ ok: true, diagnostics });
  });

  app.post("/api/test/llm", async (c) => {
    const body = await c.req.json<{
      provider: string;
      model: string;
      base_url?: string;
      api_key?: string;
    }>();
    const start = Date.now();
    const result = await testLLMConnection({
      provider: body.provider,
      model: body.model,
      baseUrl: body.base_url,
      apiKey: body.api_key,
    });
    return c.json({ ...result, latency_ms: Date.now() - start });
  });

  app.post("/api/test/embedding", async (c) => {
    const body = await c.req.json<{
      provider: string;
      model?: string;
      base_url?: string;
      api_key?: string;
    }>();
    if (body.provider === "ollama") {
      const baseUrl = body.base_url ?? "http://localhost:11434";
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
          signal: AbortSignal.timeout(3000),
        });
        return c.json({
          ok: res.ok,
          error: res.ok ? undefined : `Ollama responded with ${res.status}`,
        });
      } catch (err) {
        return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const result = await testEmbeddingConnection(
      body.base_url ?? "https://api.openai.com/v1",
      body.api_key ?? "",
      body.model ?? "",
    );
    return c.json(result);
  });

  app.get("/api/feishu/health", async (c) => {
    const client = new LarkCliHttpClient(opts.larkBin);
    try {
      const result = await client.healthCheck();
      return c.json(result);
    } catch (err) {
      return c.json({ ok: false, message: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.get("/api/feishu/groups", async (c) => {
    const client = new LarkCliHttpClient(opts.larkBin);
    try {
      const result = await client.request<{
        code: number;
        data?: { items?: Array<{ chat_id: string; name: string }> };
      }>("GET", "/open-apis/im/v1/chats", { params: { page_size: "100" } });
      const items = result.data?.items ?? [];
      return c.json({ groups: items.map((i) => ({ id: i.chat_id, name: i.name })) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  app.post("/api/setup/complete", (c) => {
    opts.onSetupComplete?.();
    return c.json({ ok: true });
  });

  return app;
}

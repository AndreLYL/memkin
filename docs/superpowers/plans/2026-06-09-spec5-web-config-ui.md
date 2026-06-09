# Spec 5 — Web Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-based setup wizard (`memoark init --web`) and settings editor (`memoark config edit --web`) as a third configuration path alongside the existing TUI and text-mode wizard.

**Architecture:** A new `createConfigRoutes(opts)` Hono sub-app provides 7 config API routes shared between a standalone `SetupServer` (for init — no memoark.yaml needed) and the existing main Hono app (for settings editing). The frontend extends the existing `web/` Vite/React 19/Tailwind SPA with two new pages: `/setup` (8-step wizard) and `/config` (collapsible settings).

**Tech Stack:** Bun + TypeScript + Hono (backend); React 19 + Vite + Tailwind CSS + react-router v7 + TanStack Query (frontend); Vitest (backend tests).

---

## File Map

```
NEW (backend)
  src/server/config-routes.ts       — 7 API routes, shared by setup + main server
  src/server/config-routes.test.ts  — Vitest unit tests for all routes
  src/server/setup-server.ts        — standalone Hono server for memoark init --web

MODIFY (backend)
  src/server/api.ts                 — mount config-routes into existing createApiApp
  src/cli.ts                        — --web flag on init, config edit --web subcommand, serve warning

NEW (frontend)
  web/src/api/config.ts             — typed API client for config endpoints
  web/src/components/config/
    SecretInput.tsx                 — password field with show/hide toggle
    PathInput.tsx                   — path field with placeholder default hint
    ToggleSwitch.tsx                — labeled on/off toggle
    ConnectionTest.tsx              — test-connection button + status indicator
  web/src/pages/setup/
    index.tsx                       — wizard root: state, step routing, navigation
    steps/Welcome.tsx
    steps/LLMConfig.tsx
    steps/EmbeddingConfig.tsx
    steps/FeishuConfig.tsx          — feishu toggle + app_id/secret + lark auth check
    steps/FeishuSources.tsx         — per-source enable/disable toggles
    steps/GroupSelection.tsx        — fetch group list or manual entry
    steps/StoragePaths.tsx          — db path + export dir
    steps/Review.tsx                — YAML preview + save
  web/src/pages/config/
    index.tsx                       — settings page root: load config, section state
    sections/LLMSection.tsx
    sections/EmbeddingSection.tsx
    sections/FeishuSection.tsx
    sections/StorageSection.tsx

MODIFY (frontend)
  web/src/router.tsx                — add /setup and /config routes (outside Shell)
```

---

## Key types to know before coding

```typescript
// src/setup/validate-config.ts — PartialConfig
interface PartialConfig {
  llm?: Partial<LLMConfig>;
  sources?: {
    "claude-code"?: Partial<SourceConfig>;
    codex?: Partial<SourceConfig>;
    hermes?: Partial<SourceConfig>;
    feishu?: Partial<FeishuSourceConfig>;
  };
  store?: Partial<StoreConfig>;
  embedding?: Partial<EmbeddingConfig>;
  server?: Partial<ServerConfig>;
  block_builder?: { block_gap_minutes?: number; max_block_tokens?: number; max_block_messages?: number };
}

// src/core/config.ts — FeishuSourceConfig.sources shape
feishu.sources.messages = { enabled: boolean; chat_ids: string[] }
feishu.sources.dm       = { enabled: boolean; dm_chat_ids?: string[] }
feishu.sources.mail     = { enabled: boolean }
feishu.sources.docs     = { enabled: boolean; doc_folders: string[] }
feishu.sources.tasks    = { enabled: boolean }
feishu.sources.calendar = { enabled: boolean; calendar_ids: string[] }

// src/config-center/validation.ts — validateDraft return
interface ConfigDiagnostic { path: string; severity: "error"|"warning"|"info"; message: string }
// NB: validateDraft requires at least one source enabled; always default claude-code enabled
```

---

### Task 1: Config API Routes

**Files:**
- Create: `src/server/config-routes.ts`
- Create: `src/server/config-routes.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/server/config-routes.test.ts
import { existsSync } from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createConfigRoutes } from "./config-routes.js";

vi.mock("../setup/connection-tests.js", () => ({
  testLLMConnection: vi.fn().mockResolvedValue({ ok: true }),
  testEmbeddingConnection: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../collectors/feishu/lark-cli-client.js", () => ({
  LarkCliHttpClient: vi.fn().mockImplementation(() => ({
    healthCheck: vi.fn().mockResolvedValue({ ok: true, message: "lark-cli user auth active" }),
    request: vi.fn().mockResolvedValue({
      code: 0,
      data: { items: [{ chat_id: "oc_abc", name: "Team Chat" }] },
    }),
  })),
}));

describe("createConfigRoutes", () => {
  let tmpDir: string;
  let configPath: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `memoark-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, "memoark.yaml");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("GET /api/config returns {} when file missing", async () => {
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it("GET /api/config returns parsed YAML when file exists", async () => {
    writeFileSync(configPath, "llm:\n  provider: openai\n  model: gpt-4o\n");
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/config");
    const data = await res.json() as { llm: { provider: string } };
    expect(data.llm?.provider).toBe("openai");
  });

  it("GET /api/config masks api_key in response", async () => {
    writeFileSync(configPath, "llm:\n  provider: openai\n  model: gpt-4o\n  api_key: sk-verylongsecret\n");
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/config");
    const data = await res.json() as { llm: { api_key: string } };
    expect(data.llm?.api_key).not.toBe("sk-verylongsecret");
    expect(data.llm?.api_key).toContain("****");
  });

  it("POST /api/config writes file and returns ok when valid", async () => {
    const app = createConfigRoutes({ configPath });
    const config = {
      llm: { provider: "openai", model: "gpt-4o-mini", api_key: "sk-test", base_url: "https://api.openai.com/v1" },
      sources: { "claude-code": { enabled: true } },
      embedding: { provider: "openai", model: "text-embedding-3-large", dimensions: 1536, api_key: "sk-test", base_url: "https://api.openai.com/v1" },
    };
    const res = await app.request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
    expect(existsSync(configPath)).toBe(true);
  });

  it("POST /api/config returns 422 when llm.provider missing", async () => {
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
    const data = await res.json() as { ok: boolean; diagnostics: Array<{ severity: string }> };
    expect(data.ok).toBe(false);
    expect(data.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  it("POST /api/test/llm returns ok with latency_ms", async () => {
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/test/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; latency_ms: number };
    expect(data.ok).toBe(true);
    expect(typeof data.latency_ms).toBe("number");
  });

  it("GET /api/feishu/health returns lark auth status", async () => {
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/feishu/health");
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean };
    expect(data.ok).toBe(true);
  });

  it("GET /api/feishu/groups maps chat_id to id", async () => {
    const app = createConfigRoutes({ configPath });
    const res = await app.request("/api/feishu/groups");
    expect(res.status).toBe(200);
    const data = await res.json() as { groups: Array<{ id: string; name: string }> };
    expect(data.groups).toEqual([{ id: "oc_abc", name: "Team Chat" }]);
  });

  it("POST /api/setup/complete calls onSetupComplete", async () => {
    const onSetupComplete = vi.fn();
    const app = createConfigRoutes({ configPath, onSetupComplete });
    const res = await app.request("/api/setup/complete", { method: "POST" });
    expect(res.status).toBe(200);
    expect(onSetupComplete).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
cd /home/user/memoark && bun test src/server/config-routes.test.ts
```

Expected: FAIL — `Cannot find module './config-routes.js'`

- [ ] **Step 3: Implement config-routes.ts**

```typescript
// src/server/config-routes.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Hono } from "hono";
import { parse } from "yaml";
import { testLLMConnection, testEmbeddingConnection } from "../setup/connection-tests.js";
import { validateDraft } from "../config-center/validation.js";
import { maskSecret } from "../config-center/secrets.js";
import { generateConfigYaml } from "../setup/generate-config.js";
import { LarkCliHttpClient } from "../collectors/feishu/lark-cli-client.js";
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
    return c.json(parsed);
  });

  app.post("/api/config", async (c) => {
    const body = await c.req.json<PartialConfig>();
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
    );
    return c.json(result);
  });

  app.get("/api/feishu/health", async (c) => {
    const client = new LarkCliHttpClient(opts.larkBin);
    const result = await client.healthCheck();
    return c.json(result);
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
```

- [ ] **Step 4: Run tests — confirm they all pass**

```bash
bun test src/server/config-routes.test.ts
```

Expected: 8 tests pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/server/config-routes.ts src/server/config-routes.test.ts
git commit -m "feat: add config API routes (GET/POST config, test LLM/embedding, feishu health/groups)"
```

---

### Task 2: SetupServer

**Files:**
- Create: `src/server/setup-server.ts`

- [ ] **Step 1: Implement SetupServer**

```typescript
// src/server/setup-server.ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { Hono } from "hono";
import { createConfigRoutes } from "./config-routes.js";
import { resolve } from "node:path";

const WEB_DIST = join(fileURLToPath(import.meta.url), "../../../web/dist");

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

export interface SetupServerOpts {
  configPath?: string;
  larkBin?: string;
  open?: boolean;
}

export async function startSetupServer(opts: SetupServerOpts = {}): Promise<void> {
  const configPath = opts.configPath ?? resolve(process.cwd(), "memoark.yaml");

  return new Promise((resolvePromise) => {
    const configRoutes = createConfigRoutes({
      configPath,
      larkBin: opts.larkBin,
      onSetupComplete: () => {
        console.log("\n✓ Configuration saved. Run `memoark serve` to start Memoark.");
        server.stop(true);
        resolvePromise();
      },
    });

    const honoApp = new Hono();
    honoApp.route("/", configRoutes);

    const server = Bun.serve({
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api")) {
          return honoApp.fetch(req);
        }
        // SPA fallback — serve web/dist/, defaulting to index.html
        const filePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
        const candidate = Bun.file(join(WEB_DIST, filePath));
        if (await candidate.exists()) return new Response(candidate);
        return new Response(Bun.file(join(WEB_DIST, "index.html")));
      },
    });

    const setupUrl = `http://localhost:${server.port}/setup`;
    console.log(`Memoark setup UI running at ${setupUrl}`);
    console.log("Press Ctrl+C to cancel.\n");

    if (opts.open !== false) {
      openBrowser(setupUrl);
    }
  });
}
```

- [ ] **Step 2: Verify it compiles**

```bash
bun run typecheck 2>&1 | grep "setup-server"
```

Expected: no errors mentioning setup-server.ts

- [ ] **Step 3: Commit**

```bash
git add src/server/setup-server.ts
git commit -m "feat: add SetupServer (standalone Hono server for memoark init --web)"
```

---

### Task 3: Mount config routes in main server

**Files:**
- Modify: `src/server/api.ts`

- [ ] **Step 1: Read the top of src/server/api.ts to find the import block and createApiApp body**

Read `src/server/api.ts` lines 1-45.

- [ ] **Step 2: Add import and mount config routes**

Add to imports at top of `src/server/api.ts`:
```typescript
import { resolve } from "node:path";
import { createConfigRoutes } from "./config-routes.js";
```

Inside `createApiApp`, immediately after `const app = new Hono();`:
```typescript
const configRoutes = createConfigRoutes({
  configPath: resolve(process.cwd(), "memoark.yaml"),
});
app.route("/", configRoutes);
```

- [ ] **Step 3: Verify typecheck passes**

```bash
bun run typecheck 2>&1 | grep -E "error|warning" | head -20
```

Expected: 0 errors

- [ ] **Step 4: Run existing tests to confirm no regression**

```bash
bun test
```

Expected: all existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: mount config API routes into main Hono app"
```

---

### Task 4: CLI wiring

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Read the init command block**

Read `src/cli.ts` lines 99–125 (init command action).

- [ ] **Step 2: Add --web flag to memoark init**

After the existing `.option("--no-tui", ...)` line, add:
```typescript
.option("--web", "Launch browser-based setup UI")
```

At the top of the `.action(async (options) => {` handler, add before the existing `runInit` call:
```typescript
if (options.web) {
  const { startSetupServer } = await import("./server/setup-server.js");
  await startSetupServer({ configPath: options.config });
  return;
}
```

- [ ] **Step 3: Read the config command group (lines 404–430)**

Read `src/cli.ts` lines 404–430 to confirm current `configCmd` structure.

- [ ] **Step 4: Add config edit --web subcommand**

After the existing `configCmd.command("init")...` block (after its closing `});`), add:

```typescript
configCmd
  .command("edit")
  .description("Edit configuration in browser UI")
  .option("--web", "Launch browser-based settings UI (default behavior)")
  .action(async () => {
    const { startSetupServer } = await import("./server/setup-server.js");
    await startSetupServer();
  });
```

- [ ] **Step 5: Read the serve command action to find where loadConfig is called**

Read `src/cli.ts` lines 480–495 (serve action start).

- [ ] **Step 6: Add no-config warning to memoark serve**

In the serve action, before `const config = loadConfig(options.config);`, add:
```typescript
const serveConfigPath = options.config ?? resolve(process.cwd(), "memoark.yaml");
if (!existsSync(serveConfigPath)) {
  console.error(
    "No configuration file found.\nRun `memoark init` (TUI) or `memoark init --web` (browser) to set up Memoark.",
  );
  process.exit(1);
}
```

Verify `existsSync` is already imported (from `node:fs`) and `resolve` from `node:path` — check the imports at the top of cli.ts. Add them if missing.

- [ ] **Step 7: Typecheck**

```bash
bun run typecheck 2>&1 | grep -E "error" | head -10
```

Expected: 0 errors

- [ ] **Step 8: Smoke test the new CLI flags (dry run — don't actually open browser)**

```bash
bun run src/cli.ts init --help 2>&1 | grep "\-\-web"
bun run src/cli.ts config --help 2>&1
```

Expected: `--web` appears in `init --help` output; `config --help` shows `edit` subcommand

- [ ] **Step 9: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add --web flag to memoark init, memoark config edit --web, serve no-config guard"
```

---

### Task 5: Frontend API client

**Files:**
- Create: `web/src/api/config.ts`

- [ ] **Step 1: Implement the API client**

```typescript
// web/src/api/config.ts
const BASE = "/api";

async function fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface WizardLLMConfig {
  provider: string;
  model: string;
  base_url?: string;
  api_key?: string;
}

export interface WizardEmbeddingConfig {
  provider: "openai" | "ollama";
  model: string;
  dimensions: number;
  base_url?: string;
  api_key?: string;
}

export interface WizardFeishuSources {
  dm?: boolean;
  messages?: boolean;
  mail?: boolean;
  docs?: boolean;
  tasks?: boolean;
  calendar?: boolean;
}

export interface WizardFeishuConfig {
  enabled?: boolean;
  app_id?: string;
  app_secret?: string;
  lark_bin?: string;
  sources?: WizardFeishuSources;
  chat_ids?: string[];  // stored in sources.feishu.sources.messages.chat_ids
}

export interface WizardConfig {
  llm?: WizardLLMConfig;
  embedding?: WizardEmbeddingConfig;
  sources?: {
    "claude-code"?: { enabled: boolean };
    feishu?: WizardFeishuConfig;
  };
  store?: { data_dir?: string };
  adapters?: { file?: { enabled: boolean; output_dir: string } };
}

export interface ConfigDiagnostic {
  path: string;
  severity: "error" | "warning" | "info";
  message: string;
}

export interface FeishuGroup {
  id: string;
  name: string;
}

export const configApi = {
  getConfig: (): Promise<WizardConfig> =>
    fetchJSON<WizardConfig>("/config"),

  saveConfig: (config: WizardConfig): Promise<{ ok: boolean; diagnostics: ConfigDiagnostic[] }> =>
    fetchJSON("/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(config),
    }),

  testLLM: (cfg: WizardLLMConfig): Promise<{ ok: boolean; latency_ms: number; error?: string }> =>
    fetchJSON("/test/llm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    }),

  testEmbedding: (cfg: {
    provider: string;
    base_url?: string;
    api_key?: string;
  }): Promise<{ ok: boolean; error?: string }> =>
    fetchJSON("/test/embedding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    }),

  feishuHealth: (): Promise<{ ok: boolean; message: string }> =>
    fetchJSON("/feishu/health"),

  feishuGroups: (): Promise<{ groups?: FeishuGroup[]; error?: string }> =>
    fetchJSON("/feishu/groups"),

  setupComplete: (): Promise<Response> =>
    fetch(`${BASE}/setup/complete`, { method: "POST" }),
};
```

- [ ] **Step 2: Typecheck**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | grep -E "error" | head -10
```

Expected: builds without errors (or errors unrelated to config.ts)

- [ ] **Step 3: Commit**

```bash
git add web/src/api/config.ts
git commit -m "feat: add frontend API client for config endpoints"
```

---

### Task 6: Shared config UI components

**Files:**
- Create: `web/src/components/config/SecretInput.tsx`
- Create: `web/src/components/config/PathInput.tsx`
- Create: `web/src/components/config/ToggleSwitch.tsx`
- Create: `web/src/components/config/ConnectionTest.tsx`

- [ ] **Step 1: Implement SecretInput**

```tsx
// web/src/components/config/SecretInput.tsx
import { useState } from "react";

interface SecretInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}

export function SecretInput({ id, label, value, onChange, placeholder, required }: SecretInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg-default">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded border border-border-default px-2 py-1 text-xs text-fg-muted hover:text-fg-default"
        >
          {show ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement PathInput**

```tsx
// web/src/components/config/PathInput.tsx
interface PathInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultHint?: string;
  optional?: boolean;
}

export function PathInput({ id, label, value, onChange, defaultHint, optional }: PathInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg-default">
        {label}{optional && <span className="text-fg-muted ml-1 font-normal">(optional)</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={defaultHint}
        className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {defaultHint && !value && (
        <p className="text-xs text-fg-muted">Default: {defaultHint}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Implement ToggleSwitch**

```tsx
// web/src/components/config/ToggleSwitch.tsx
interface ToggleSwitchProps {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
}

export function ToggleSwitch({ id, label, checked, onChange, description }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-fg-default cursor-pointer">
          {label}
        </label>
        {description && <p className="text-xs text-fg-muted mt-0.5">{description}</p>}
      </div>
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-blue-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Implement ConnectionTest**

```tsx
// web/src/components/config/ConnectionTest.tsx
import { useState } from "react";

type TestStatus = "idle" | "testing" | "ok" | "failed";

interface ConnectionTestProps {
  label?: string;
  onTest: () => Promise<{ ok: boolean; error?: string; latency_ms?: number }>;
}

export function ConnectionTest({ label = "Test Connection", onTest }: ConnectionTestProps) {
  const [status, setStatus] = useState<TestStatus>("idle");
  const [message, setMessage] = useState<string>("");

  const run = async () => {
    setStatus("testing");
    setMessage("");
    try {
      const result = await onTest();
      if (result.ok) {
        setStatus("ok");
        setMessage(result.latency_ms ? `${result.latency_ms}ms` : "Connected");
      } else {
        setStatus("failed");
        setMessage(result.error ?? "Connection failed");
      }
    } catch (err) {
      setStatus("failed");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const statusIcon = { idle: "", testing: "⏳", ok: "✓", failed: "✗" }[status];
  const statusColor = { idle: "", testing: "text-fg-muted", ok: "text-green-600", failed: "text-red-500" }[status];

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={run}
        disabled={status === "testing"}
        className="rounded border border-border-default px-3 py-1.5 text-sm text-fg-default hover:bg-bg-subtle disabled:opacity-50"
      >
        {status === "testing" ? "Testing..." : label}
      </button>
      {(status !== "idle") && (
        <span className={`text-sm ${statusColor}`}>
          {statusIcon} {message}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Build frontend to verify no TypeScript errors**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | grep -E "error TS" | head -10
```

Expected: 0 TypeScript errors in the new files

- [ ] **Step 6: Commit**

```bash
git add web/src/components/config/
git commit -m "feat: add shared config UI components (SecretInput, PathInput, ToggleSwitch, ConnectionTest)"
```

---

### Task 7: Wizard step components

**Files:**
- Create: `web/src/pages/setup/steps/Welcome.tsx`
- Create: `web/src/pages/setup/steps/LLMConfig.tsx`
- Create: `web/src/pages/setup/steps/EmbeddingConfig.tsx`
- Create: `web/src/pages/setup/steps/FeishuConfig.tsx`
- Create: `web/src/pages/setup/steps/FeishuSources.tsx`
- Create: `web/src/pages/setup/steps/GroupSelection.tsx`
- Create: `web/src/pages/setup/steps/StoragePaths.tsx`
- Create: `web/src/pages/setup/steps/Review.tsx`

All step components share this prop shape:
```typescript
interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}
```

- [ ] **Step 1: Implement Welcome.tsx**

```tsx
// web/src/pages/setup/steps/Welcome.tsx
import type { WizardConfig } from "../../../api/config";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function Welcome({ onNext }: StepProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-fg-default">Welcome to Memoark</h1>
        <p className="mt-2 text-fg-muted">
          Memoark is a local-first AI memory layer. This wizard will help you configure
          your LLM, embedding model, data sources, and storage in a few steps.
        </p>
      </div>
      <p className="text-sm text-fg-muted">This takes about 5 minutes.</p>
      <div className="flex justify-end">
        <button
          onClick={onNext}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Get Started →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement LLMConfig.tsx**

```tsx
// web/src/pages/setup/steps/LLMConfig.tsx
import type { WizardConfig, WizardLLMConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic", defaultUrl: "https://api.anthropic.com", defaultModel: "claude-3-haiku-20240307" },
  { value: "custom", label: "Custom / Proxy", defaultUrl: "", defaultModel: "" },
];

export function LLMConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const llm = config.llm ?? { provider: "openai", model: "gpt-4o-mini", base_url: "https://api.openai.com/v1", api_key: "" };

  const update = (patch: Partial<WizardLLMConfig>) =>
    onUpdate({ llm: { ...llm, ...patch } });

  const selectedProvider = PROVIDERS.find((p) => p.value === llm.provider) ?? PROVIDERS[2];

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">LLM Configuration</h2>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Provider</label>
        <select
          value={llm.provider}
          onChange={(e) => {
            const p = PROVIDERS.find((x) => x.value === e.target.value) ?? PROVIDERS[0];
            update({ provider: p.value, base_url: p.defaultUrl, model: p.defaultModel });
          }}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Model <span className="text-red-500">*</span></label>
        <input
          type="text"
          value={llm.model ?? ""}
          onChange={(e) => update({ model: e.target.value })}
          placeholder={selectedProvider.defaultModel}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Base URL</label>
        <input
          type="text"
          value={llm.base_url ?? ""}
          onChange={(e) => update({ base_url: e.target.value })}
          placeholder={selectedProvider.defaultUrl}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        />
      </div>

      <SecretInput
        id="llm-api-key"
        label="API Key"
        value={llm.api_key ?? ""}
        onChange={(v) => update({ api_key: v })}
        placeholder="sk-..."
        required
      />

      <ConnectionTest
        onTest={() => configApi.testLLM(llm as WizardLLMConfig)}
      />

      <div className="flex justify-between pt-2">
        {onBack && (
          <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>
        )}
        <button
          onClick={onNext}
          disabled={!llm.model || !llm.api_key}
          className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement EmbeddingConfig.tsx**

```tsx
// web/src/pages/setup/steps/EmbeddingConfig.tsx
import type { WizardConfig, WizardEmbeddingConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function EmbeddingConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const emb = config.embedding ?? { provider: "openai", model: "text-embedding-3-large", dimensions: 1536, base_url: "https://api.openai.com/v1", api_key: "" };

  const update = (patch: Partial<WizardEmbeddingConfig>) =>
    onUpdate({ embedding: { ...emb, ...patch } });

  const isOllama = emb.provider === "ollama";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Embedding Configuration</h2>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Provider</label>
        <select
          value={emb.provider}
          onChange={(e) => {
            if (e.target.value === "ollama") {
              update({ provider: "ollama", model: "nomic-embed-text", dimensions: 768, base_url: "http://localhost:11434", api_key: undefined });
            } else {
              update({ provider: "openai", model: "text-embedding-3-large", dimensions: 1536, base_url: "https://api.openai.com/v1" });
            }
          }}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default"
        >
          <option value="openai">OpenAI</option>
          <option value="ollama">Ollama (local)</option>
        </select>
      </div>

      <div className="flex gap-3">
        <div className="flex-1 flex flex-col gap-1">
          <label className="text-sm font-medium text-fg-default">Model</label>
          <input type="text" value={emb.model ?? ""} onChange={(e) => update({ model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="w-24 flex flex-col gap-1">
          <label className="text-sm font-medium text-fg-default">Dimensions</label>
          <input type="number" value={emb.dimensions ?? ""} onChange={(e) => update({ dimensions: Number(e.target.value) })}
            className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-fg-default">Base URL</label>
        <input type="text" value={emb.base_url ?? ""} onChange={(e) => update({ base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
      </div>

      {!isOllama && (
        <SecretInput id="emb-api-key" label="API Key" value={emb.api_key ?? ""} onChange={(v) => update({ api_key: v })} required />
      )}

      <ConnectionTest onTest={() => configApi.testEmbedding({ provider: emb.provider, base_url: emb.base_url, api_key: emb.api_key })} />

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Implement FeishuConfig.tsx**

```tsx
// web/src/pages/setup/steps/FeishuConfig.tsx
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function FeishuConfig({ config, onUpdate, onNext, onBack }: StepProps) {
  const feishu = config.sources?.feishu ?? {};
  const enabled = feishu.enabled ?? false;

  const updateFeishu = (patch: object) =>
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, ...patch } } });

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Feishu (Lark) Configuration</h2>

      <ToggleSwitch
        id="feishu-enabled"
        label="I use Feishu / Lark"
        checked={enabled}
        onChange={(v) => updateFeishu({ enabled: v })}
      />

      {enabled && (
        <>
          <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <strong>Prerequisite:</strong> Feishu data access requires the <code>lark</code> CLI
            binary to be installed and authenticated. Run the lark CLI login command (see lark-cli
            documentation) in your terminal before proceeding.
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-fg-default">App ID</label>
            <input type="text" value={feishu.app_id ?? ""} onChange={(e) => updateFeishu({ app_id: e.target.value })}
              placeholder="cli_..." className="rounded border border-border-default bg-bg-default px-3 py-1.5 text-sm text-fg-default" />
          </div>

          <SecretInput id="feishu-secret" label="App Secret" value={feishu.app_secret ?? ""}
            onChange={(v) => updateFeishu({ app_secret: v })} />

          <div>
            <p className="text-sm font-medium text-fg-default mb-2">lark auth status</p>
            <ConnectionTest
              label="Check lark auth"
              onTest={() => configApi.feishuHealth()}
            />
          </div>
        </>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
          {enabled ? "Next →" : "Skip →"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement FeishuSources.tsx**

```tsx
// web/src/pages/setup/steps/FeishuSources.tsx
import type { WizardConfig, WizardFeishuSources } from "../../../api/config";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

const SOURCE_LIST: { key: keyof WizardFeishuSources; label: string; description: string }[] = [
  { key: "dm", label: "Direct Messages", description: "Private 1-on-1 chats" },
  { key: "messages", label: "Group Messages", description: "Messages from selected group chats" },
  { key: "mail", label: "Email (Mail)", description: "Feishu inbox emails" },
  { key: "docs", label: "Docs", description: "Feishu documents and wikis" },
  { key: "tasks", label: "Tasks", description: "Feishu task items" },
  { key: "calendar", label: "Calendar", description: "Calendar events" },
];

export function FeishuSources({ config, onUpdate, onNext, onBack }: StepProps) {
  const feishu = config.sources?.feishu ?? {};
  const sources = feishu.sources ?? {};

  const toggle = (key: keyof WizardFeishuSources, value: boolean) =>
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, sources: { ...sources, [key]: value } } } });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold text-fg-default">Feishu Data Sources</h2>
      <p className="text-sm text-fg-muted">Choose which Feishu data types to extract.</p>

      <div className="divide-y divide-border-default rounded border border-border-default px-4">
        {SOURCE_LIST.map(({ key, label, description }) => (
          <ToggleSwitch
            key={key}
            id={`feishu-src-${key}`}
            label={label}
            description={description}
            checked={sources[key] ?? false}
            onChange={(v) => toggle(key, v)}
          />
        ))}
      </div>

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Implement GroupSelection.tsx**

```tsx
// web/src/pages/setup/steps/GroupSelection.tsx
import { useState } from "react";
import type { WizardConfig, FeishuGroup } from "../../../api/config";
import { configApi } from "../../../api/config";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function GroupSelection({ config, onUpdate, onNext, onBack }: StepProps) {
  const [groups, setGroups] = useState<FeishuGroup[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const feishu = config.sources?.feishu ?? {};
  const selectedIds = feishu.chat_ids ?? [];

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await configApi.feishuGroups();
      if ("error" in result && result.error) {
        setError(result.error);
        setManualMode(true);
      } else if ("groups" in result && result.groups) {
        setGroups(result.groups);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setManualMode(true);
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (id: string) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, chat_ids: next } } });
  };

  const saveManual = () => {
    const ids = manualInput.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    onUpdate({ sources: { ...config.sources, feishu: { ...feishu, chat_ids: ids } } });
  };

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Select Group Chats</h2>
      <p className="text-sm text-fg-muted">Choose which group chats to extract messages from.</p>

      {!groups && !manualMode && (
        <button
          onClick={fetchGroups}
          disabled={loading}
          className="self-start rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Fetching..." : "Fetch My Group List"}
        </button>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Failed to fetch groups: {error}
        </div>
      )}

      {groups && !manualMode && (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto rounded border border-border-default p-3">
          {groups.map((g) => (
            <label key={g.id} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
                className="rounded"
              />
              <span className="text-sm text-fg-default">{g.name}</span>
              <span className="text-xs text-fg-muted">{g.id}</span>
            </label>
          ))}
        </div>
      )}

      {manualMode && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-fg-default">Group IDs (one per line)</label>
          <textarea
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            onBlur={saveManual}
            rows={4}
            placeholder="oc_abc123&#10;oc_def456"
            className="rounded border border-border-default bg-bg-default px-3 py-2 text-sm text-fg-default font-mono"
          />
        </div>
      )}

      {!manualMode && (
        <button onClick={() => setManualMode(true)} className="self-start text-xs text-blue-600 underline">
          Enter Group IDs manually instead
        </button>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Implement StoragePaths.tsx**

```tsx
// web/src/pages/setup/steps/StoragePaths.tsx
import type { WizardConfig } from "../../../api/config";
import { PathInput } from "../../../components/config/PathInput";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

export function StoragePaths({ config, onUpdate, onNext, onBack }: StepProps) {
  const dataDir = config.store?.data_dir ?? "";
  const exportDir = config.adapters?.file?.output_dir ?? "";

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Storage Paths</h2>

      <PathInput
        id="data-dir"
        label="Database Path"
        value={dataDir}
        onChange={(v) => onUpdate({ store: { data_dir: v } })}
        defaultHint="~/.memoark/data"
      />

      <PathInput
        id="export-dir"
        label="Markdown Export Directory"
        value={exportDir}
        onChange={(v) => onUpdate({ adapters: { file: { enabled: Boolean(v), output_dir: v } } })}
        defaultHint="~/Documents/memoark-export"
        optional
      />

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button onClick={onNext} className="ml-auto rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Implement Review.tsx**

```tsx
// web/src/pages/setup/steps/Review.tsx
import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";

interface StepProps {
  config: WizardConfig;
  onUpdate: (patch: Partial<WizardConfig>) => void;
  onNext: () => void;
  onBack?: () => void;
}

function maskKey(v: string | undefined) {
  if (!v) return "(not set)";
  if (v.length <= 8) return "****";
  return `${v.slice(0, 4)}...****`;
}

export function Review({ config, onBack }: StepProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      // Ensure claude-code is enabled as the fallback source
      const configToSave: WizardConfig = {
        ...config,
        sources: {
          "claude-code": { enabled: true },
          ...config.sources,
        },
      };
      const result = await configApi.saveConfig(configToSave);
      if (!result.ok) {
        setErrors(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message));
        return;
      }
      // Signal setup complete so SetupServer shuts down
      await configApi.setupComplete();
      setSaved(true);
    } catch (err) {
      setErrors([err instanceof Error ? err.message : String(err)]);
    } finally {
      setSaving(false);
    }
  };

  if (saved) {
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="text-4xl">✓</div>
        <h2 className="text-xl font-bold text-fg-default">Configuration Saved!</h2>
        <p className="text-fg-muted">Run <code className="rounded bg-bg-subtle px-1">memoark serve</code> to start Memoark.</p>
      </div>
    );
  }

  const llm = config.llm;
  const emb = config.embedding;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-bold text-fg-default">Review Configuration</h2>

      <div className="rounded border border-border-default divide-y divide-border-default text-sm">
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">LLM Provider</span>
          <span className="text-fg-default">{llm?.provider ?? "—"} / {llm?.model ?? "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">LLM API Key</span>
          <span className="text-fg-default font-mono">{maskKey(llm?.api_key)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Embedding</span>
          <span className="text-fg-default">{emb?.provider ?? "—"} / {emb?.model ?? "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Feishu</span>
          <span className="text-fg-default">{config.sources?.feishu?.enabled ? "Enabled" : "Disabled"}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 px-4 py-3">
          <span className="text-fg-muted">Database Path</span>
          <span className="text-fg-default font-mono">{config.store?.data_dir || "~/.memoark/data (default)"}</span>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3">
          {errors.map((e, i) => <p key={i} className="text-sm text-red-700">{e}</p>)}
        </div>
      )}

      <div className="flex justify-between pt-2">
        {onBack && <button onClick={onBack} className="rounded border border-border-default px-4 py-2 text-sm text-fg-default hover:bg-bg-subtle">← Back</button>}
        <button
          onClick={save}
          disabled={saving}
          className="ml-auto rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Configuration ✓"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | grep -E "error TS" | head -20
```

Expected: 0 TypeScript errors

- [ ] **Step 10: Commit**

```bash
git add web/src/pages/setup/steps/
git commit -m "feat: add wizard step components (Welcome through Review)"
```

---

### Task 8: Wizard page (state management + navigation)

**Files:**
- Create: `web/src/pages/setup/index.tsx`

- [ ] **Step 1: Implement wizard root**

```tsx
// web/src/pages/setup/index.tsx
import { useState } from "react";
import type { WizardConfig } from "../../api/config";
import { Welcome } from "./steps/Welcome";
import { LLMConfig } from "./steps/LLMConfig";
import { EmbeddingConfig } from "./steps/EmbeddingConfig";
import { FeishuConfig } from "./steps/FeishuConfig";
import { FeishuSources } from "./steps/FeishuSources";
import { GroupSelection } from "./steps/GroupSelection";
import { StoragePaths } from "./steps/StoragePaths";
import { Review } from "./steps/Review";

const TOTAL_STEPS = 8;

const STEP_LABELS = [
  "Welcome",
  "LLM",
  "Embedding",
  "Feishu",
  "Sources",
  "Groups",
  "Storage",
  "Review",
];

export function SetupWizard() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<WizardConfig>({
    sources: { "claude-code": { enabled: true } },
  });

  const update = (patch: Partial<WizardConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const feishuEnabled = config.sources?.feishu?.enabled ?? false;
  const messagesEnabled = config.sources?.feishu?.sources?.messages ?? false;

  const next = () => {
    setStep((s) => {
      // Skip feishu source/group steps if feishu disabled
      if (s === 3 && !feishuEnabled) return 6; // skip steps 4,5 → StoragePaths
      // Skip group step if messages not enabled
      if (s === 4 && !messagesEnabled) return 6; // skip step 5 → StoragePaths
      return Math.min(s + 1, TOTAL_STEPS - 1);
    });
  };

  const back = () => {
    setStep((s) => {
      if (s === 6 && !feishuEnabled) return 3;  // back past skipped steps
      if (s === 6 && !messagesEnabled) return 4; // back past group step
      return Math.max(s - 1, 0);
    });
  };

  const stepProps = { config, onUpdate: update, onNext: next, onBack: step > 0 ? back : undefined };
  const steps = [
    <Welcome {...stepProps} />,
    <LLMConfig {...stepProps} />,
    <EmbeddingConfig {...stepProps} />,
    <FeishuConfig {...stepProps} />,
    <FeishuSources {...stepProps} />,
    <GroupSelection {...stepProps} />,
    <StoragePaths {...stepProps} />,
    <Review {...stepProps} />,
  ];

  return (
    <div className="min-h-screen bg-bg-canvas flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-xl">
        {/* Progress bar */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-fg-muted mb-1">
            <span>Step {step + 1} of {TOTAL_STEPS}</span>
            <span>{STEP_LABELS[step]}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-subtle">
            <div
              className="h-1.5 rounded-full bg-blue-500 transition-all"
              style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        <div className="rounded-lg border border-border-default bg-bg-default p-8 shadow-sm">
          {steps[step]}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript build**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | grep -E "error TS" | head -10
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/setup/index.tsx
git commit -m "feat: add wizard page with step navigation and feishu skip logic"
```

---

### Task 9: Settings page

**Files:**
- Create: `web/src/pages/config/sections/LLMSection.tsx`
- Create: `web/src/pages/config/sections/EmbeddingSection.tsx`
- Create: `web/src/pages/config/sections/FeishuSection.tsx`
- Create: `web/src/pages/config/sections/StorageSection.tsx`
- Create: `web/src/pages/config/index.tsx`

- [ ] **Step 1: Implement LLMSection.tsx**

```tsx
// web/src/pages/config/sections/LLMSection.tsx
import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function LLMSection({ config, onSave }: SectionProps) {
  const [llm, setLlm] = useState(config.llm ?? { provider: "openai", model: "", base_url: "", api_key: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ llm }); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">LLM</h3>
        <button onClick={save} disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Provider</label>
          <input type="text" value={llm.provider} onChange={(e) => setLlm({ ...llm, provider: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Model</label>
          <input type="text" value={llm.model} onChange={(e) => setLlm({ ...llm, model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Base URL</label>
        <input type="text" value={llm.base_url ?? ""} onChange={(e) => setLlm({ ...llm, base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
      </div>
      <SecretInput id="cfg-llm-key" label="API Key" value={llm.api_key ?? ""} onChange={(v) => setLlm({ ...llm, api_key: v })} />
      <ConnectionTest onTest={() => configApi.testLLM(llm)} />
    </div>
  );
}
```

- [ ] **Step 2: Implement EmbeddingSection.tsx**

```tsx
// web/src/pages/config/sections/EmbeddingSection.tsx
import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function EmbeddingSection({ config, onSave }: SectionProps) {
  const [emb, setEmb] = useState(config.embedding ?? { provider: "openai" as const, model: "", dimensions: 1536, base_url: "", api_key: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ embedding: emb }); } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Embedding</h3>
        <button onClick={save} disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Provider</label>
          <select value={emb.provider} onChange={(e) => setEmb({ ...emb, provider: e.target.value as "openai" | "ollama" })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default">
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Model</label>
          <input type="text" value={emb.model} onChange={(e) => setEmb({ ...emb, model: e.target.value })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Dimensions</label>
          <input type="number" value={emb.dimensions} onChange={(e) => setEmb({ ...emb, dimensions: Number(e.target.value) })}
            className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Base URL</label>
        <input type="text" value={emb.base_url ?? ""} onChange={(e) => setEmb({ ...emb, base_url: e.target.value })}
          className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
      </div>
      {emb.provider === "openai" && (
        <SecretInput id="cfg-emb-key" label="API Key" value={emb.api_key ?? ""} onChange={(v) => setEmb({ ...emb, api_key: v })} />
      )}
      <ConnectionTest onTest={() => configApi.testEmbedding({ provider: emb.provider, base_url: emb.base_url, api_key: emb.api_key })} />
    </div>
  );
}
```

- [ ] **Step 3: Implement FeishuSection.tsx**

```tsx
// web/src/pages/config/sections/FeishuSection.tsx
import { useState } from "react";
import type { WizardConfig, WizardFeishuSources } from "../../../api/config";
import { configApi } from "../../../api/config";
import { SecretInput } from "../../../components/config/SecretInput";
import { ToggleSwitch } from "../../../components/config/ToggleSwitch";
import { ConnectionTest } from "../../../components/config/ConnectionTest";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

const SOURCES: { key: keyof WizardFeishuSources; label: string }[] = [
  { key: "dm", label: "Direct Messages" },
  { key: "messages", label: "Group Messages" },
  { key: "mail", label: "Email" },
  { key: "docs", label: "Docs" },
  { key: "tasks", label: "Tasks" },
  { key: "calendar", label: "Calendar" },
];

export function FeishuSection({ config, onSave }: SectionProps) {
  const [feishu, setFeishu] = useState(config.sources?.feishu ?? {});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try { await onSave({ sources: { ...config.sources, feishu } }); } finally { setSaving(false); }
  };

  const sources = feishu.sources ?? {};

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Feishu</h3>
        <button onClick={save} disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <ToggleSwitch id="cfg-feishu-enabled" label="Feishu enabled" checked={feishu.enabled ?? false}
        onChange={(v) => setFeishu({ ...feishu, enabled: v })} />
      {feishu.enabled && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-muted">App ID</label>
              <input type="text" value={feishu.app_id ?? ""} onChange={(e) => setFeishu({ ...feishu, app_id: e.target.value })}
                className="rounded border border-border-default bg-bg-default px-2 py-1.5 text-sm text-fg-default" />
            </div>
            <SecretInput id="cfg-feishu-secret" label="App Secret" value={feishu.app_secret ?? ""}
              onChange={(v) => setFeishu({ ...feishu, app_secret: v })} />
          </div>
          <ConnectionTest label="Check lark auth" onTest={() => configApi.feishuHealth()} />
          <div className="divide-y divide-border-default rounded border border-border-default px-4">
            {SOURCES.map(({ key, label }) => (
              <ToggleSwitch key={key} id={`cfg-src-${key}`} label={label}
                checked={sources[key] ?? false}
                onChange={(v) => setFeishu({ ...feishu, sources: { ...sources, [key]: v } })} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Implement StorageSection.tsx**

```tsx
// web/src/pages/config/sections/StorageSection.tsx
import { useState } from "react";
import type { WizardConfig } from "../../../api/config";
import { PathInput } from "../../../components/config/PathInput";

interface SectionProps {
  config: WizardConfig;
  onSave: (patch: Partial<WizardConfig>) => Promise<void>;
}

export function StorageSection({ config, onSave }: SectionProps) {
  const [dataDir, setDataDir] = useState(config.store?.data_dir ?? "");
  const [exportDir, setExportDir] = useState(config.adapters?.file?.output_dir ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        store: { data_dir: dataDir },
        adapters: exportDir ? { file: { enabled: true, output_dir: exportDir } } : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-base font-semibold text-fg-default">Storage</h3>
        <button onClick={save} disabled={saving}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <PathInput id="cfg-data-dir" label="Database Path" value={dataDir} onChange={setDataDir} defaultHint="~/.memoark/data" />
      <PathInput id="cfg-export-dir" label="Markdown Export Directory" value={exportDir} onChange={setExportDir}
        defaultHint="~/Documents/memoark-export" optional />
    </div>
  );
}
```

- [ ] **Step 5: Implement settings page root (config/index.tsx)**

```tsx
// web/src/pages/config/index.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { WizardConfig } from "../../api/config";
import { configApi } from "../../api/config";
import { LLMSection } from "./sections/LLMSection";
import { EmbeddingSection } from "./sections/EmbeddingSection";
import { FeishuSection } from "./sections/FeishuSection";
import { StorageSection } from "./sections/StorageSection";

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border-default bg-bg-default">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-semibold text-fg-default">{title}</span>
        <span className="text-fg-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="border-t border-border-default px-5 py-4">{children}</div>}
    </div>
  );
}

export function ConfigPage() {
  const queryClient = useQueryClient();
  const { data: config, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: configApi.getConfig,
  });

  const saveMutation = useMutation({
    mutationFn: (next: WizardConfig) => configApi.saveConfig(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["config"] }),
  });

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async (patch: Partial<WizardConfig>) => {
    setSaveError(null);
    const merged: WizardConfig = { ...config, ...patch };
    const result = await saveMutation.mutateAsync(merged);
    if (!result.ok) {
      setSaveError(result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join(", "));
    }
  };

  if (isLoading || !config) {
    return <div className="flex items-center justify-center min-h-screen text-fg-muted">Loading configuration...</div>;
  }

  return (
    <div className="min-h-screen bg-bg-canvas px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-fg-default mb-6">Configuration</h1>

        {saveError && (
          <div className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <div className="flex flex-col gap-4">
          <Section title="LLM"><LLMSection config={config} onSave={handleSave} /></Section>
          <Section title="Embedding"><EmbeddingSection config={config} onSave={handleSave} /></Section>
          <Section title="Feishu"><FeishuSection config={config} onSave={handleSave} /></Section>
          <Section title="Storage"><StorageSection config={config} onSave={handleSave} /></Section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Build check**

```bash
cd /home/user/memoark && bun run web:build 2>&1 | grep -E "error TS" | head -20
```

Expected: 0 TypeScript errors

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/config/
git commit -m "feat: add settings page with collapsible LLM/Embedding/Feishu/Storage sections"
```

---

### Task 10: Router wiring and end-to-end verification

**Files:**
- Modify: `web/src/router.tsx`

- [ ] **Step 1: Read current router.tsx**

Read `web/src/router.tsx` (full file, ~25 lines).

- [ ] **Step 2: Add /setup and /config routes outside Shell**

The setup and config pages don't use the Shell (no sidebar). Add them as top-level routes alongside the Shell route:

```typescript
// web/src/router.tsx
import { createBrowserRouter, Navigate } from "react-router";
import { Shell } from "./components/layout/shell";
import { Dashboard } from "./pages/dashboard";
import { PageList } from "./pages/page-list";
import { PageDetail } from "./pages/page-detail";
import { GraphPage } from "./pages/graph";
import { SearchPage } from "./pages/search";
import { TimelinePage } from "./pages/Timeline";
import { EntityDetail } from "./pages/EntityDetail";
import { SetupWizard } from "./pages/setup/index";
import { ConfigPage } from "./pages/config/index";

export const router = createBrowserRouter([
  { path: "setup", element: <SetupWizard /> },
  { path: "config", element: <ConfigPage /> },
  {
    element: <Shell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "timeline", element: <TimelinePage /> },
      { path: "graph", element: <GraphPage /> },
      { path: "entity/*", element: <EntityDetail /> },
      { path: "entities", element: <Navigate to="/pages" replace /> },
      { path: "pages", element: <PageList /> },
      { path: "pages/*", element: <PageDetail /> },
      { path: "search", element: <SearchPage /> },
    ],
  },
]);
```

- [ ] **Step 3: Final build — must pass clean**

```bash
cd /home/user/memoark && bun run web:build 2>&1
```

Expected: Build succeeds, `web/dist/` updated. No TypeScript errors.

- [ ] **Step 4: Run all backend tests**

```bash
cd /home/user/memoark && bun test
```

Expected: All tests pass, including the new `config-routes.test.ts`

- [ ] **Step 5: Run typecheck on the full project**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 6: Smoke test CLI flags (no browser needed)**

```bash
# Verify --web flag appears on memoark init
bun run src/cli.ts init --help 2>&1 | grep "web"

# Verify config edit --web subcommand exists
bun run src/cli.ts config --help 2>&1
bun run src/cli.ts config edit --help 2>&1 | grep "web"
```

Expected: each grep finds the flag/subcommand in the output

- [ ] **Step 7: Commit**

```bash
git add web/src/router.tsx
git commit -m "feat: wire /setup and /config routes into web app router"
```

- [ ] **Step 8: Final integration commit**

```bash
git add -A
git commit -m "feat: complete Spec 5 — web config wizard and settings center"
git push -u origin claude/repository-issues-review-TZG4j
```

---

## Self-review: spec coverage

| Spec requirement | Task |
|---|---|
| `memoark init --web` entry point | Task 4 |
| `memoark config edit --web` entry point | Task 4 |
| `memoark serve` no-config warning | Task 4 |
| SetupServer (standalone, random port, no StoreContext) | Task 2 |
| Config routes shared between setup + main server | Tasks 1, 3 |
| GET /api/config + POST /api/config (validateDraft gate) | Task 1 |
| POST /api/test/llm + /api/test/embedding | Task 1 |
| GET /api/feishu/health (lark auth status) | Task 1 |
| GET /api/feishu/groups (lark --as user api) | Task 1 |
| POST /api/setup/complete (graceful shutdown) | Tasks 1, 2 |
| Frontend API client | Task 5 |
| SecretInput, PathInput, ToggleSwitch, ConnectionTest | Task 6 |
| 8-step wizard (Welcome→Review) | Tasks 7, 8 |
| Feishu step skip logic when disabled | Task 8 |
| Group step skip when messages disabled | Task 8 |
| Group fetch with manual fallback | Task 7 (GroupSelection) |
| Settings page (4 collapsible sections) | Task 9 |
| Router `/setup` and `/config` (outside Shell) | Task 10 |
| TUI and text wizard left untouched | ✓ (no tasks modify config-center/ or setup/) |

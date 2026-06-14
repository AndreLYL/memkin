import type { LLMProvider } from "../../../extractors/providers/types.js";
import type { ChunkStore } from "../../../store/chunks.js";
import type { PageStore } from "../../../store/pages.js";
import type { IFeishuHttpClient } from "../http-client.js";
import { FullCardBuilder } from "./full-builder.js";
import { mergeUserNoteIntoCard } from "./render.js";
import { writeCard } from "./store-writer.js";
import type { DocCandidate, FullCard } from "./types.js";
import { parseFeishuUrl } from "./url-parser.js";
import { resolveWikiNode, WikiNodeNotFoundError } from "./wiki-resolver.js";

export interface IngestDeps {
  client: IFeishuHttpClient;
  stores: { pages: PageStore; chunks: ChunkStore };
  provider: LLMProvider;
  model: string;
  nowIso: () => string;
}

export interface IngestInput {
  url_or_token: string;
  note?: string;
  tags?: string[];
  force_refresh?: boolean;
}

export type IngestOutput =
  | { ok: true; doc_token: string; extract_level: "full"; was_existing: boolean; card: FullCard }
  | {
      ok: false;
      error:
        | { code: "INVALID_URL"; message: string }
        | { code: "UNSUPPORTED_DOC_TYPE"; type: string; message: string }
        // PERMISSION_DENIED is reserved: under the current lark-cli client the HTTP
        // status is unavailable (execLark loses it — FeishuApiError is thrown with
        // status 0), so a 403 cannot be reliably distinguished. 403s currently
        // surface as NETWORK_ERROR (meta fetch) or LLM_FAILED (blocks fetch). Wire
        // real 403 detection when/if the client exposes HTTP status.
        | { code: "PERMISSION_DENIED"; doc_token: string }
        | { code: "WIKI_NODE_NOT_FOUND"; node_token: string }
        | { code: "LLM_FAILED"; doc_token: string; saved_as: "pointer"; original_error: string }
        | { code: "NETWORK_ERROR"; message: string };
    };

// CALIBRATED 2026-06-14 against POST /open-apis/drive/v1/metas/batch_query with
// body { request_docs: [{ doc_token, doc_type }] }. The response `url` comes back
// as an EMPTY STRING "" (not undefined), so `??` would keep it — use `||` to fall
// back. Unlike the drive/v1/files list API, the meta API DOES return the real last
// editor via `latest_modify_user`.
async function fetchDocMeta(
  client: IFeishuHttpClient,
  docToken: string,
): Promise<{
  title: string;
  url: string;
  owner_id: string;
  last_editor_id: string;
  created: string;
  modified: string;
}> {
  const res = await client.request<{
    code: number;
    data?: {
      metas?: Array<{
        title?: string;
        url?: string;
        owner_id?: string;
        latest_modify_user?: string;
        create_time?: string;
        latest_modify_time?: string;
      }>;
    };
  }>("POST", "/open-apis/drive/v1/metas/batch_query", {
    body: { request_docs: [{ doc_token: docToken, doc_type: "docx" }] },
  });
  const m = res.data?.metas?.[0] ?? {};
  return {
    title: m.title || docToken,
    url: m.url || `https://feishu.cn/docx/${docToken}`,
    owner_id: m.owner_id ?? "",
    last_editor_id: m.latest_modify_user || m.owner_id || "",
    created: m.create_time || "0",
    modified: m.latest_modify_time || "0",
  };
}

export async function ingestFeishuDoc(deps: IngestDeps, input: IngestInput): Promise<IngestOutput> {
  const parsed = parseFeishuUrl(input.url_or_token);
  if (parsed.kind === "reject") {
    if (parsed.code === "UNSUPPORTED_DOC_TYPE") {
      return {
        ok: false,
        error: { code: "UNSUPPORTED_DOC_TYPE", type: "non_docx", message: parsed.message },
      };
    }
    return { ok: false, error: { code: "INVALID_URL", message: parsed.message } };
  }

  let docToken: string;
  try {
    if (parsed.kind === "wiki_node") {
      const resolved = await resolveWikiNode(deps.client, parsed.node_token);
      if (resolved.obj_type !== "docx") {
        return {
          ok: false,
          error: {
            code: "UNSUPPORTED_DOC_TYPE",
            type: resolved.obj_type,
            message: "Wiki node is not a docx",
          },
        };
      }
      docToken = resolved.obj_token;
    } else {
      docToken = parsed.token;
    }
  } catch (err) {
    if (err instanceof WikiNodeNotFoundError) {
      return { ok: false, error: { code: "WIKI_NODE_NOT_FOUND", node_token: err.node_token } };
    }
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : String(err) },
    };
  }

  const now = deps.nowIso();
  let meta: Awaited<ReturnType<typeof fetchDocMeta>>;
  try {
    meta = await fetchDocMeta(deps.client, docToken);
  } catch (err) {
    return {
      ok: false,
      error: { code: "NETWORK_ERROR", message: err instanceof Error ? err.message : String(err) },
    };
  }

  const existing = await deps.stores.pages.getPage(`feishu-docs/${docToken}`);
  const candidate: DocCandidate = {
    doc_token: docToken,
    doc_type: "docx",
    title: meta.title,
    url: meta.url,
    owner_id: meta.owner_id,
    last_editor_id: meta.last_editor_id,
    created_at:
      meta.created === "0" ? now : new Date(Number.parseInt(meta.created, 10) * 1000).toISOString(),
    modified_at:
      meta.modified === "0"
        ? now
        : new Date(Number.parseInt(meta.modified, 10) * 1000).toISOString(),
    source: { kind: "mcp_ingest" },
    parent_path: "MCP ingest/",
  };

  const builder = new FullCardBuilder(deps.client, deps.provider, deps.model, deps.nowIso);
  const card = await builder.build(candidate, {
    userNote: input.note,
    tags: input.tags,
    force: true,
  });

  if (card.extract_level === "pointer") {
    // build degraded (empty blocks or LLM failure) — persist the pointer and report
    await writeCard(deps.stores, card);
    return {
      ok: false,
      error: {
        code: "LLM_FAILED",
        doc_token: docToken,
        saved_as: "pointer",
        original_error: card.extract_error ?? card.extract_skipped ?? "unknown",
      },
    };
  }

  const finalCard = input.note ? mergeUserNoteIntoCard(card, input.note) : card;
  await writeCard(deps.stores, finalCard);
  return {
    ok: true,
    doc_token: docToken,
    extract_level: "full",
    was_existing: existing !== null,
    card: finalCard,
  };
}

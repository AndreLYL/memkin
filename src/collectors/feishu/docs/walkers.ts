import type { IFeishuHttpClient } from "../http-client.js";
import type { FeishuDriveFile } from "../types.js";
import { driveFileToCandidate, type FeishuWikiNode, wikiNodeToCandidate } from "./candidate.js";
import type { ResolvedDocsConfig } from "./config.js";
import type { DocCandidate, DocSourceOrigin } from "./types.js";

/**
 * Recursively walk a drive folder. docx files → candidates; folders → recurse
 * while depth budget remains. `source` describes the origin for emitted
 * candidates; `parentPath` is the human-readable breadcrumb.
 * CALIBRATED 2026-06-14: drive/v1/files rows carry `type` with live values
 * folder/docx/bitable/file, so `file.type === "folder"` / `"docx"` are correct.
 */
export async function* walkDriveFolder(
  client: IFeishuHttpClient,
  folderToken: string,
  source: DocSourceOrigin,
  parentPath: string,
  maxDepth: number,
): AsyncGenerator<DocCandidate> {
  for await (const page of client.paginate<FeishuDriveFile>("/open-apis/drive/v1/files", {
    folder_token: folderToken,
    page_size: "50",
  })) {
    for (const file of page.items) {
      if (file.type === "folder") {
        if (maxDepth > 0) {
          yield* walkDriveFolder(
            client,
            file.token,
            source,
            `${parentPath}${file.name}/`,
            maxDepth - 1,
          );
        }
        continue;
      }
      if (file.type !== "docx") continue;
      yield driveFileToCandidate(file, source, parentPath);
    }
  }
}

interface FeishuWikiSpace {
  space_id: string;
  name: string;
}

/**
 * Walk every wiki space (minus excluded ids) and emit docx nodes.
 * CALIBRATED 2026-06-14: wiki/v2/spaces rows expose `space_id`/`name`, and
 * wiki/v2/spaces/<id>/nodes rows expose `node_token`/`obj_token`/`obj_type`/
 * `title` plus `owner` (the last-editor field, NOT `owner_id`) and a real `url`.
 */
export async function* walkWiki(
  client: IFeishuHttpClient,
  excludeSpaceIds: string[],
): AsyncGenerator<DocCandidate> {
  const excluded = new Set(excludeSpaceIds);
  for await (const spacePage of client.paginate<FeishuWikiSpace>("/open-apis/wiki/v2/spaces")) {
    for (const space of spacePage.items) {
      if (excluded.has(space.space_id)) continue;
      for await (const nodePage of client.paginate<FeishuWikiNode & { obj_type: string }>(
        `/open-apis/wiki/v2/spaces/${space.space_id}/nodes`,
      )) {
        for (const node of nodePage.items) {
          if (node.obj_type !== "docx") continue;
          yield wikiNodeToCandidate(
            node,
            {
              kind: "wiki",
              space_id: space.space_id,
              space_name: space.name,
              node_token: node.node_token,
            },
            `Wiki/${space.name}/`,
          );
        }
      }
    }
  }
}

/**
 * CALIBRATED 2026-06-14 against real lark-cli: the endpoint is the explorer v2
 * API (the drive/v1 path returns HTTP 404), and the root token is at data.token.
 * Real response: { code: 0, data: { id, token, user_id }, msg: "success" }.
 */
async function getMySpaceRoot(client: IFeishuHttpClient): Promise<string | null> {
  const res = await client.request<{ code: number; data?: { token?: string } }>(
    "GET",
    "/open-apis/drive/explorer/v2/root_folder/meta",
  );
  return res.data?.token ?? null;
}

/**
 * Union of all configured walkers, deduped by doc_token. My Space first, then
 * whitelist folders, then Wiki — first occurrence wins.
 */
export async function* iterateCandidates(
  client: IFeishuHttpClient,
  config: ResolvedDocsConfig,
): AsyncGenerator<DocCandidate> {
  const seen = new Set<string>();

  const emit = async function* (gen: AsyncGenerator<DocCandidate>) {
    for await (const c of gen) {
      if (seen.has(c.doc_token)) continue;
      seen.add(c.doc_token);
      yield c;
    }
  };

  if (config.my_space.enabled) {
    const root = await getMySpaceRoot(client);
    if (root) {
      yield* emit(
        walkDriveFolder(
          client,
          root,
          { kind: "my_space", folder_token: root },
          "My Space/",
          config.my_space.max_depth,
        ),
      );
    }
  }

  for (const folder of config.folders) {
    yield* emit(
      walkDriveFolder(
        client,
        folder.token,
        { kind: "folder", folder_token: folder.token, folder_name: folder.name },
        `${folder.name}/`,
        config.my_space.max_depth,
      ),
    );
  }

  if (config.wiki.enabled) {
    yield* emit(walkWiki(client, config.wiki.exclude_space_ids));
  }
}

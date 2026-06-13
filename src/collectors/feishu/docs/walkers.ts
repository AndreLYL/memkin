import type { IFeishuHttpClient } from "../http-client.js";
import type { FeishuDriveFile } from "../types.js";
import { driveFileToCandidate, type FeishuWikiNode, wikiNodeToCandidate } from "./candidate.js";
import type { DocCandidate, DocSourceOrigin } from "./types.js";

/**
 * Recursively walk a drive folder. docx files → candidates; folders → recurse
 * while depth budget remains. `source` describes the origin for emitted
 * candidates; `parentPath` is the human-readable breadcrumb.
 * ⚠️ CALIBRATE: file.type === "folder" / "docx" against Task 1.
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
 * ⚠️ CALIBRATE: space/node field names + obj_type values against Task 1.
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
            { kind: "wiki", space_id: space.space_id, space_name: space.name, node_token: node.node_token },
            `Wiki/${space.name}/`,
          );
        }
      }
    }
  }
}

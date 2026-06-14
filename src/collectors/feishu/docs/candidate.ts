import type { FeishuDriveFile } from "../types.js";
import type { DocCandidate, DocSourceOrigin } from "./types.js";

function secToIso(sec: string): string {
  return new Date(Number.parseInt(sec, 10) * 1000).toISOString();
}

export function driveFileToCandidate(
  file: FeishuDriveFile,
  source: DocSourceOrigin,
  parentPath: string,
): DocCandidate {
  // CALIBRATED 2026-06-14: the drive/v1/files list API does not return edit_users;
  // last_editor_id falls back to owner_id. (For My Space this means T1 self_edit
  // effectively means self-owned.)
  const lastEditor = file.owner_id;
  return {
    doc_token: file.token,
    doc_type: "docx",
    title: file.name,
    url: file.url,
    owner_id: file.owner_id,
    last_editor_id: lastEditor,
    created_at: secToIso(file.created_time),
    modified_at: secToIso(file.modified_time),
    source,
    parent_path: parentPath,
  };
}

// CALIBRATED 2026-06-14 against the real wiki/v2/spaces/<id>/nodes row: the
// last-editor field is `owner` (NOT `owner_id`), and the row carries a real
// `url`. obj_edit_time/obj_create_time are epoch-second strings.
export interface FeishuWikiNode {
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  obj_edit_time: string; // epoch seconds
  obj_create_time: string;
  owner?: string;
  url?: string;
}

export function wikiNodeToCandidate(
  node: FeishuWikiNode,
  source: Extract<DocSourceOrigin, { kind: "wiki" }>,
  parentPath: string,
): DocCandidate {
  return {
    doc_token: node.obj_token,
    doc_type: "docx",
    title: node.title,
    url: node.url ?? `https://feishu.cn/wiki/${node.node_token}`,
    owner_id: node.owner ?? "",
    last_editor_id: node.owner ?? "",
    created_at: secToIso(node.obj_create_time),
    modified_at: secToIso(node.obj_edit_time),
    source,
    parent_path: parentPath,
  };
}

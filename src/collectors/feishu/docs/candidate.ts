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
  const lastEditor = file.edit_users?.[0]?.open_id ?? file.owner_id; // ⚠️ CALIBRATE: edit_users ordering
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

// ⚠️ CALIBRATE all field names below against Task 1's wiki_node fixture.
export interface FeishuWikiNode {
  node_token: string;
  obj_token: string;
  obj_type: string;
  title: string;
  obj_edit_time: string; // epoch seconds
  obj_create_time: string;
  owner_id?: string;
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
    url: `https://feishu.cn/wiki/${node.node_token}`,
    owner_id: node.owner_id ?? "",
    last_editor_id: node.owner_id ?? "",
    created_at: secToIso(node.obj_create_time),
    modified_at: secToIso(node.obj_edit_time),
    source,
    parent_path: parentPath,
  };
}

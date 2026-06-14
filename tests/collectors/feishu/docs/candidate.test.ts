import { describe, expect, test } from "vitest";
import {
  driveFileToCandidate,
  wikiNodeToCandidate,
} from "../../../../src/collectors/feishu/docs/candidate";
import type { FeishuDriveFile } from "../../../../src/collectors/feishu/types";

// CALIBRATED 2026-06-14: the drive/v1/files list API returns no edit_users,
// so last_editor_id always falls back to owner_id.
const file: FeishuDriveFile = {
  token: "doc_tok",
  name: "Roadmap",
  type: "docx",
  url: "https://feishu.cn/docx/doc_tok",
  owner_id: "ou_owner",
  created_time: "1700000000",
  modified_time: "1717200000",
};

describe("driveFileToCandidate", () => {
  test("maps a docx drive file under My Space", () => {
    const c = driveFileToCandidate(file, { kind: "my_space", folder_token: "fld_a" }, "My Space/");
    expect(c).toEqual({
      doc_token: "doc_tok",
      doc_type: "docx",
      title: "Roadmap",
      url: "https://feishu.cn/docx/doc_tok",
      owner_id: "ou_owner",
      last_editor_id: "ou_owner",
      created_at: new Date(1700000000 * 1000).toISOString(),
      modified_at: new Date(1717200000 * 1000).toISOString(),
      source: { kind: "my_space", folder_token: "fld_a" },
      parent_path: "My Space/",
    });
  });

  test("last_editor_id falls back to owner (list API has no edit_users)", () => {
    const c = driveFileToCandidate(
      file,
      { kind: "folder", folder_token: "fld_x", folder_name: "X" },
      "X/",
    );
    expect(c.last_editor_id).toBe("ou_owner");
  });
});

describe("wikiNodeToCandidate", () => {
  test("maps a resolved wiki node (obj_token as doc_token)", () => {
    const node = {
      node_token: "nd_1",
      obj_token: "obj_doc",
      obj_type: "docx",
      title: "Wiki Doc",
      obj_edit_time: "1717200000",
      obj_create_time: "1700000000",
      owner: "ou_owner",
    };
    const c = wikiNodeToCandidate(
      node,
      {
        kind: "wiki",
        space_id: "sp_1",
        space_name: "Research",
        node_token: "nd_1",
      },
      "Wiki/Research/",
    );
    expect(c.doc_token).toBe("obj_doc");
    expect(c.doc_type).toBe("docx");
    expect(c.title).toBe("Wiki Doc");
    expect(c.url).toContain("nd_1");
    expect(c.source.kind).toBe("wiki");
  });
});

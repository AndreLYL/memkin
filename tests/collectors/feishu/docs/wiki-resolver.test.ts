import { describe, expect, test } from "vitest";
import {
  resolveWikiNode,
  WikiNodeNotFoundError,
} from "../../../../src/collectors/feishu/docs/wiki-resolver";

describe("resolveWikiNode", () => {
  test("returns obj_token + obj_type from get_node", async () => {
    const client = {
      async request() {
        return { code: 0, data: { node: { obj_token: "obj_doc", obj_type: "docx" } } };
      },
      async *paginate() {},
      async execShortcut() {
        return "";
      },
    };
    expect(await resolveWikiNode(client as never, "nd_1")).toEqual({
      obj_token: "obj_doc",
      obj_type: "docx",
    });
  });

  test("throws WikiNodeNotFoundError when node missing", async () => {
    const client = {
      async request() {
        return { code: 0, data: {} };
      },
      async *paginate() {},
      async execShortcut() {
        return "";
      },
    };
    await expect(resolveWikiNode(client as never, "nd_x")).rejects.toBeInstanceOf(
      WikiNodeNotFoundError,
    );
  });
});

import { describe, expect, test } from "vitest";
import { normalizeDocsConfig } from "../../../../src/collectors/feishu/docs/config";
import {
  iterateCandidates,
  walkDriveFolder,
  walkWiki,
} from "../../../../src/collectors/feishu/docs/walkers";
import type { PagedResult } from "../../../../src/collectors/feishu/http-client";

// Minimal fake LarkCliHttpClient with a scripted paginate.
function fakeClient(pages: Record<string, unknown[]>) {
  return {
    async *paginate(_path: string, params?: Record<string, string>) {
      const key = params?.folder_token ?? "root";
      yield { items: pages[key] ?? [], has_more: false } as PagedResult<unknown>;
    },
    async request() {
      throw new Error("not used");
    },
    async execShortcut() {
      return "";
    },
  };
}

describe("walkDriveFolder", () => {
  test("emits docx files and recurses into subfolders", async () => {
    const client = fakeClient({
      root: [
        {
          token: "d1",
          name: "Doc1",
          type: "docx",
          url: "u1",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
        {
          token: "sub",
          name: "Sub",
          type: "folder",
          url: "u",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
      ],
      sub: [
        {
          token: "d2",
          name: "Doc2",
          type: "docx",
          url: "u2",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
      ],
    });
    const out: string[] = [];
    for await (const c of walkDriveFolder(
      client as never,
      "root",
      { kind: "my_space", folder_token: "root" },
      "My Space/",
      10,
    )) {
      out.push(c.doc_token);
    }
    expect(out.sort()).toEqual(["d1", "d2"]);
  });

  test("respects max depth (no recursion at depth 0)", async () => {
    const client = fakeClient({
      root: [
        {
          token: "sub",
          name: "Sub",
          type: "folder",
          url: "u",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
      ],
      sub: [
        {
          token: "d2",
          name: "Doc2",
          type: "docx",
          url: "u2",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
      ],
    });
    const out: string[] = [];
    for await (const c of walkDriveFolder(
      client as never,
      "root",
      { kind: "my_space", folder_token: "root" },
      "My Space/",
      0,
    )) {
      out.push(c.doc_token);
    }
    expect(out).toEqual([]); // depth 0 → cannot descend into "sub"
  });

  test("ignores non-docx files", async () => {
    const client = fakeClient({
      root: [
        {
          token: "s1",
          name: "Sheet",
          type: "sheet",
          url: "u",
          owner_id: "o",
          created_time: "1",
          modified_time: "2",
        },
      ],
    });
    const out = [];
    for await (const c of walkDriveFolder(
      client as never,
      "root",
      { kind: "my_space", folder_token: "root" },
      "My Space/",
      10,
    )) {
      out.push(c);
    }
    expect(out).toEqual([]);
  });
});

function fakeWikiClient(spaces: unknown[], nodesBySpace: Record<string, unknown[]>) {
  return {
    async *paginate(path: string, _params?: Record<string, string>) {
      if (path.endsWith("/spaces")) {
        yield { items: spaces, has_more: false };
        return;
      }
      const spaceId = path.split("/spaces/")[1]?.split("/")[0] ?? "";
      yield { items: nodesBySpace[spaceId] ?? [], has_more: false };
    },
    async request() {
      throw new Error("not used");
    },
    async execShortcut() {
      return "";
    },
  };
}

describe("walkWiki", () => {
  test("emits docx nodes across spaces, skips excluded spaces and non-docx nodes", async () => {
    const client = fakeWikiClient(
      [
        { space_id: "sp1", name: "Research" },
        { space_id: "sp2", name: "Excluded" },
      ],
      {
        sp1: [
          {
            node_token: "n1",
            obj_token: "o1",
            obj_type: "docx",
            title: "A",
            obj_edit_time: "2",
            obj_create_time: "1",
          },
          {
            node_token: "n2",
            obj_token: "o2",
            obj_type: "sheet",
            title: "B",
            obj_edit_time: "2",
            obj_create_time: "1",
          },
        ],
        sp2: [
          {
            node_token: "n3",
            obj_token: "o3",
            obj_type: "docx",
            title: "C",
            obj_edit_time: "2",
            obj_create_time: "1",
          },
        ],
      },
    );
    const out: string[] = [];
    for await (const c of walkWiki(client as never, ["sp2"])) {
      out.push(c.doc_token);
    }
    expect(out).toEqual(["o1"]);
  });
});

describe("iterateCandidates", () => {
  test("dedupes the same doc_token seen in My Space and a whitelist folder", async () => {
    const dup = {
      token: "dup",
      name: "Dup",
      type: "docx",
      url: "u",
      owner_id: "o",
      created_time: "1",
      modified_time: "2",
    };
    const client = {
      async request(_m: string, path: string) {
        if (path.endsWith("/root_folder/meta")) return { code: 0, data: { token: "root" } };
        throw new Error(`unexpected ${path}`);
      },
      async *paginate(_path: string, params?: Record<string, string>) {
        const key = params?.folder_token;
        if (key === "root") yield { items: [dup], has_more: false };
        else if (key === "fld_white") yield { items: [dup], has_more: false };
        else yield { items: [], has_more: false };
      },
      async execShortcut() {
        return "";
      },
    };
    const cfg = normalizeDocsConfig({
      enabled: true,
      wiki: { enabled: false },
      folders: [{ token: "fld_white", name: "White" }],
    });
    const out: string[] = [];
    for await (const c of iterateCandidates(client as never, cfg)) {
      out.push(c.doc_token);
    }
    expect(out).toEqual(["dup"]); // deduped
  });
});

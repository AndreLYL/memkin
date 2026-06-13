import { describe, expect, test } from "vitest";
import { walkDriveFolder } from "../../../../src/collectors/feishu/docs/walkers";
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
        { token: "d1", name: "Doc1", type: "docx", url: "u1", owner_id: "o", created_time: "1", modified_time: "2" },
        { token: "sub", name: "Sub", type: "folder", url: "u", owner_id: "o", created_time: "1", modified_time: "2" },
      ],
      sub: [
        { token: "d2", name: "Doc2", type: "docx", url: "u2", owner_id: "o", created_time: "1", modified_time: "2" },
      ],
    });
    const out: string[] = [];
    for await (const c of walkDriveFolder(client as never, "root", { kind: "my_space", folder_token: "root" }, "My Space/", 10)) {
      out.push(c.doc_token);
    }
    expect(out.sort()).toEqual(["d1", "d2"]);
  });

  test("respects max depth (no recursion at depth 0)", async () => {
    const client = fakeClient({
      root: [{ token: "sub", name: "Sub", type: "folder", url: "u", owner_id: "o", created_time: "1", modified_time: "2" }],
      sub: [{ token: "d2", name: "Doc2", type: "docx", url: "u2", owner_id: "o", created_time: "1", modified_time: "2" }],
    });
    const out: string[] = [];
    for await (const c of walkDriveFolder(client as never, "root", { kind: "my_space", folder_token: "root" }, "My Space/", 0)) {
      out.push(c.doc_token);
    }
    expect(out).toEqual([]); // depth 0 → cannot descend into "sub"
  });

  test("ignores non-docx files", async () => {
    const client = fakeClient({
      root: [{ token: "s1", name: "Sheet", type: "sheet", url: "u", owner_id: "o", created_time: "1", modified_time: "2" }],
    });
    const out = [];
    for await (const c of walkDriveFolder(client as never, "root", { kind: "my_space", folder_token: "root" }, "My Space/", 10)) {
      out.push(c);
    }
    expect(out).toEqual([]);
  });
});

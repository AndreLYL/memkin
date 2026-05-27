import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LarkCliHttpClient } from "../../../src/collectors/feishu/lark-cli-client";
import { FeishuApiError } from "../../../src/collectors/feishu/types";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";

const mockExecFile = vi.mocked(execFile);

function mockExecSuccess(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(null, stdout, "");
    return {} as any;
  });
}

function mockExecError(message: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, cb: any) => {
    cb(new Error(message), "", "");
    return {} as any;
  });
}

describe("LarkCliHttpClient", () => {
  let client: LarkCliHttpClient;

  beforeEach(() => {
    client = new LarkCliHttpClient("/usr/local/bin/lark");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("request", () => {
    it("calls lark-cli with correct args for GET", async () => {
      const response = { code: 0, data: { items: [] } };
      mockExecSuccess(JSON.stringify(response));

      const result = await client.request("GET", "/open-apis/im/v1/chats");

      expect(mockExecFile).toHaveBeenCalledWith(
        "/usr/local/bin/lark",
        ["--as", "user", "api", "GET", "/open-apis/im/v1/chats", "--format", "json"],
        expect.any(Object),
        expect.any(Function),
      );
      expect(result).toEqual(response);
    });

    it("passes params as --params JSON", async () => {
      mockExecSuccess(JSON.stringify({ code: 0 }));

      await client.request("GET", "/open-apis/im/v1/messages", {
        params: { container_id_type: "chat", container_id: "oc_123" },
      });

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain("--params");
      const paramsIdx = args.indexOf("--params");
      const parsed = JSON.parse(args[paramsIdx + 1]);
      expect(parsed.container_id).toBe("oc_123");
    });

    it("passes body as --data JSON for POST", async () => {
      mockExecSuccess(JSON.stringify({ code: 0 }));

      await client.request("POST", "/open-apis/im/v1/messages", {
        body: { content: "hello" },
      });

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain("--data");
      const dataIdx = args.indexOf("--data");
      expect(JSON.parse(args[dataIdx + 1])).toEqual({ content: "hello" });
    });

    it("throws FeishuApiError on exec failure", async () => {
      mockExecError("Command failed");

      await expect(client.request("GET", "/open-apis/test")).rejects.toThrow(FeishuApiError);
    });
  });

  describe("paginate", () => {
    it("collects items from NDJSON stream (flat items with progress lines)", async () => {
      const lines = [
        "[page 1] fetching...",
        JSON.stringify({ id: "1", name: "a" }),
        JSON.stringify({ id: "2", name: "b" }),
        "[page 2] fetching...",
        JSON.stringify({ id: "3", name: "c" }),
      ].join("\n");
      mockExecSuccess(lines);

      const pages = [];
      for await (const page of client.paginate("/open-apis/im/v1/messages")) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(pages[0].items).toHaveLength(3);
      expect(pages[0].items[0]).toEqual({ id: "1", name: "a" });
      expect(pages[0].has_more).toBe(false);
    });

    it("uses --page-all --format ndjson flags", async () => {
      mockExecSuccess(JSON.stringify({ id: "1" }));

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of client.paginate("/open-apis/test")) {
        /* consume */
      }

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args).toContain("--page-all");
      expect(args).toContain("--format");
      expect(args[args.indexOf("--format") + 1]).toBe("ndjson");
    });

    it("skips bracket-prefixed progress lines", async () => {
      const lines = ["[page 1] fetching...", "[warn] something", JSON.stringify({ id: "1" })].join(
        "\n",
      );
      mockExecSuccess(lines);

      const pages = [];
      for await (const page of client.paginate("/open-apis/test")) {
        pages.push(page);
      }

      expect(pages[0].items).toHaveLength(1);
    });
  });

  describe("healthCheck", () => {
    it("returns ok when lark auth status succeeds", async () => {
      mockExecSuccess("Logged in as user");

      const result = await client.healthCheck();
      expect(result.ok).toBe(true);
    });

    it("returns not ok when lark auth fails", async () => {
      mockExecError("Not logged in");

      const result = await client.healthCheck();
      expect(result.ok).toBe(false);
    });
  });
});

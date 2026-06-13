import { describe, expect, test } from "vitest";
import { parseFeishuUrl } from "../../../../src/collectors/feishu/docs/url-parser";

describe("parseFeishuUrl", () => {
  test("raw token (>=20 alphanumerics) → docx", () => {
    expect(parseFeishuUrl("Abngd03Swoll47xr347c8rhrndg")).toEqual({
      kind: "docx",
      token: "Abngd03Swoll47xr347c8rhrndg",
    });
  });

  test("docx url → docx token", () => {
    expect(parseFeishuUrl("https://my.feishu.cn/docx/Abngd03Swoll47xr347c8rhrndg")).toEqual({
      kind: "docx",
      token: "Abngd03Swoll47xr347c8rhrndg",
    });
  });

  test("docx url with query string strips the query", () => {
    expect(
      parseFeishuUrl("https://x.feishu.cn/docx/Abngd03Swoll47xr347c8rhrndg?from=space"),
    ).toEqual({ kind: "docx", token: "Abngd03Swoll47xr347c8rhrndg" });
  });

  test("wiki url → wiki_node", () => {
    expect(parseFeishuUrl("https://my.feishu.cn/wiki/Z4PVwFtrKiYOOjkgrY5cYNf6n1d")).toEqual({
      kind: "wiki_node",
      node_token: "Z4PVwFtrKiYOOjkgrY5cYNf6n1d",
    });
  });

  test("old /docs/ url → reject UNSUPPORTED_DOC_TYPE", () => {
    const r = parseFeishuUrl("https://my.feishu.cn/docs/oldtoken1234567890ab");
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.code).toBe("UNSUPPORTED_DOC_TYPE");
  });

  test("sheets url → reject UNSUPPORTED_DOC_TYPE", () => {
    const r = parseFeishuUrl("https://my.feishu.cn/sheets/shtcn1234567890abcdef");
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.code).toBe("UNSUPPORTED_DOC_TYPE");
  });

  test("base url → reject UNSUPPORTED_DOC_TYPE", () => {
    const r = parseFeishuUrl("https://my.feishu.cn/base/bascn1234567890abcdef");
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.code).toBe("UNSUPPORTED_DOC_TYPE");
  });

  test("garbage → reject INVALID_URL", () => {
    const r = parseFeishuUrl("not a url");
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.code).toBe("INVALID_URL");
  });

  test("short token (<20) → reject INVALID_URL", () => {
    const r = parseFeishuUrl("abc123");
    expect(r.kind).toBe("reject");
    if (r.kind === "reject") expect(r.code).toBe("INVALID_URL");
  });
});

import type { ParsedFeishuUrl } from "./types.js";

const RAW_TOKEN = /^[A-Za-z0-9]{20,}$/;
const DOCX_URL = /feishu\.[a-z]+\/docx\/([A-Za-z0-9]+)/;
const WIKI_URL = /feishu\.[a-z]+\/wiki\/([A-Za-z0-9]+)/;
const OLD_DOC_URL = /feishu\.[a-z]+\/docs\//;
const UNSUPPORTED_URL = /feishu\.[a-z]+\/(sheets|base|mindnotes|file|slides)\//;

export function parseFeishuUrl(input: string): ParsedFeishuUrl {
  const value = input.trim();

  if (RAW_TOKEN.test(value)) {
    return { kind: "docx", token: value };
  }

  const docx = value.match(DOCX_URL);
  if (docx) {
    return { kind: "docx", token: docx[1] };
  }

  const wiki = value.match(WIKI_URL);
  if (wiki) {
    return { kind: "wiki_node", node_token: wiki[1] };
  }

  if (OLD_DOC_URL.test(value)) {
    return {
      kind: "reject",
      code: "UNSUPPORTED_DOC_TYPE",
      message: "Old /docs/ documents are not supported in v1 (docx only)",
    };
  }

  if (UNSUPPORTED_URL.test(value)) {
    return {
      kind: "reject",
      code: "UNSUPPORTED_DOC_TYPE",
      message: "Only docx is supported in v1",
    };
  }

  return { kind: "reject", code: "INVALID_URL", message: `Unrecognized Feishu URL or token: ${input}` };
}

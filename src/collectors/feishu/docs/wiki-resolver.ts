import type { IFeishuHttpClient } from "../http-client.js";

export class WikiNodeNotFoundError extends Error {
  constructor(public node_token: string) {
    super(`Wiki node not found: ${node_token}`);
    this.name = "WikiNodeNotFoundError";
  }
}

/**
 * CALIBRATED 2026-06-14: GET /open-apis/wiki/v2/spaces/get_node returns the node
 * under data.node, carrying obj_token/obj_type (same fields seen live on the
 * wiki/v2/spaces/<id>/nodes rows — see probe-fixtures.md wiki_node_row).
 */
export async function resolveWikiNode(
  client: IFeishuHttpClient,
  nodeToken: string,
): Promise<{ obj_token: string; obj_type: string }> {
  const res = await client.request<{
    code: number;
    data?: { node?: { obj_token?: string; obj_type?: string } };
  }>("GET", "/open-apis/wiki/v2/spaces/get_node", {
    params: { token: nodeToken, obj_type: "wiki" },
  });
  const node = res.data?.node;
  if (!node?.obj_token || !node.obj_type) {
    throw new WikiNodeNotFoundError(nodeToken);
  }
  return { obj_token: node.obj_token, obj_type: node.obj_type };
}

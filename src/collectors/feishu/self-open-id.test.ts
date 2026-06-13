import { describe, expect, it, vi } from "vitest";
import type { LarkCliHttpClient } from "./lark-cli-client.js";
import { resolveSelfOpenId } from "./self-open-id.js";

function clientReturning(value: unknown | Error): LarkCliHttpClient {
  return {
    getAuthStatus: vi.fn(async () => {
      if (value instanceof Error) throw value;
      return value;
    }),
  } as unknown as LarkCliHttpClient;
}

describe("resolveSelfOpenId", () => {
  it("returns yaml override when provided (without calling lark-cli)", async () => {
    const client = clientReturning({ userOpenId: "ou_should_not_be_used", tokenStatus: "valid" });
    const id = await resolveSelfOpenId(client, "ou_from_yaml");
    expect(id).toBe("ou_from_yaml");
    expect(client.getAuthStatus).not.toHaveBeenCalled();
  });

  it("parses userOpenId from lark auth status when no override", async () => {
    const client = clientReturning({ userOpenId: "ou_from_lark", tokenStatus: "valid" });
    const id = await resolveSelfOpenId(client, undefined);
    expect(id).toBe("ou_from_lark");
  });

  it("returns null when tokenStatus is not valid", async () => {
    const client = clientReturning({ userOpenId: "ou_expired", tokenStatus: "no_token" });
    const id = await resolveSelfOpenId(client, undefined);
    expect(id).toBeNull();
  });

  it("returns null when getAuthStatus throws", async () => {
    const client = clientReturning(new Error("lark-cli failed"));
    const id = await resolveSelfOpenId(client, undefined);
    expect(id).toBeNull();
  });

  it("returns null when userOpenId field is missing", async () => {
    const client = clientReturning({ tokenStatus: "valid" });
    const id = await resolveSelfOpenId(client, undefined);
    expect(id).toBeNull();
  });

  it("treats empty-string yaml override as no override (falls through to lark-cli)", async () => {
    // An explicit `self_open_id: ""` in yaml is more likely a user mistake than
    // intentional disable, so we treat the falsy empty string the same as the
    // field being absent and fall back to lark-cli.
    const client = clientReturning({ userOpenId: "ou_from_lark", tokenStatus: "valid" });
    const id = await resolveSelfOpenId(client, "");
    expect(id).toBe("ou_from_lark");
    expect(client.getAuthStatus).toHaveBeenCalled();
  });
});

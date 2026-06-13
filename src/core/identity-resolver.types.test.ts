import { describe, it, expectTypeOf } from "vitest";
import type { IdentityBackend } from "./identity-resolver.js";

describe("IdentityBackend interface", () => {
  it("has resolveFeishuChatId returning name-only", () => {
    type Result = ReturnType<IdentityBackend["resolveFeishuChatId"]>;
    expectTypeOf<Result>().toEqualTypeOf<Promise<{ name: string } | null>>();
  });

  it("retains existing resolveFeishuOpenId", () => {
    type Result = ReturnType<IdentityBackend["resolveFeishuOpenId"]>;
    expectTypeOf<Result>().toEqualTypeOf<Promise<{ name: string; slugHint?: string } | null>>();
  });
});

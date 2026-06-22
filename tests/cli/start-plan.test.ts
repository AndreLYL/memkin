import { describe, expect, it } from "vitest";
import { planStartup } from "../../src/cli-helpers.js";

describe("planStartup", () => {
  it("runs setup THEN serve when no config exists", () => {
    expect(planStartup(false)).toEqual({ runSetup: true, thenServe: true });
  });
  it("serves directly when config exists", () => {
    expect(planStartup(true)).toEqual({ runSetup: false, thenServe: true });
  });
});

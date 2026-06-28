import { describe, expect, it } from "vitest";
import { makeFakeRunner } from "./runner.js";

describe("FakeRunner", () => {
  it("records argv and returns scripted result", async () => {
    const runner = makeFakeRunner([{ code: 0, stdout: "ok", stderr: "" }]);
    const r = await runner.run(["launchctl", "print", "x"]);
    expect(r).toEqual({ code: 0, stdout: "ok", stderr: "" });
    expect(runner.calls).toEqual([["launchctl", "print", "x"]]);
  });
  it("returns a default when queue is exhausted", async () => {
    const runner = makeFakeRunner([]);
    const r = await runner.run(["x"]);
    expect(r.code).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { getIntent, registerIntent } from "../../src/synth/intent.js";
import type { IntentTemplate } from "../../src/synth/types.js";

const dummy: IntentTemplate = {
  id: "dummy-intent",
  format: "single",
  buildScope: (args) => ({ query: args.query as string | undefined }),
  systemPrompt: "dummy",
  gapRules: [],
};

describe("synth/intent registry", () => {
  it("registers and retrieves an intent (round-trip)", () => {
    registerIntent(dummy);
    expect(getIntent("dummy-intent").id).toBe("dummy-intent");
  });

  it("throws for an unknown intent", () => {
    expect(() => getIntent("does-not-exist")).toThrow(/unknown synth intent/);
  });

  it("exposes the recall intent after importing intents/index", async () => {
    await import("../../src/synth/intents/index.js");
    const recall = getIntent("recall");
    expect(recall.id).toBe("recall");
    expect(recall.format).toBe("single");
    expect(recall.staleDays).toBe(14);
    expect(recall.gapRules.length).toBeGreaterThanOrEqual(1);
    // buildScope passes through entity/query/time and sets limit
    const scope = recall.buildScope({ entity: "people/zhang-san" });
    expect(scope.entity).toBe("people/zhang-san");
    expect(scope.limit).toBe(30);
  });
});

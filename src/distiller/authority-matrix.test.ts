import { describe, expect, it } from "vitest";
import { admissibility } from "./authority-matrix.js";

describe("authority admissibility matrix (spec §5)", () => {
  it("decision/preference need user_confirmed to reach canonical", () => {
    for (const type of ["decision", "preference"] as const) {
      expect(admissibility(type, "user_confirmed")).toBe("canonical");
      expect(admissibility(type, "assistant_claimed")).toBe("session_log_only");
      expect(admissibility(type, "assistant_proposed")).toBe("session_log_only");
    }
  });

  it("task/reference/knowledge/discovery allow assistant_claimed to reach canonical", () => {
    for (const type of ["task", "reference", "knowledge", "discovery"] as const) {
      expect(admissibility(type, "user_confirmed")).toBe("canonical");
      expect(admissibility(type, "assistant_claimed")).toBe("canonical");
      expect(admissibility(type, "assistant_proposed")).toBe("session_log_only");
    }
  });

  it("assistant_proposed is always session_log_only regardless of type", () => {
    for (const type of [
      "decision",
      "preference",
      "task",
      "reference",
      "knowledge",
      "discovery",
    ] as const) {
      expect(admissibility(type, "assistant_proposed")).toBe("session_log_only");
    }
  });
});

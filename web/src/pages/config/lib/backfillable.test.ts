import { describe, expect, it } from "vitest";
import { BACKFILLABLE_SOURCES, isBackfillable } from "./backfillable.js";

describe("backfillable", () => {
  it("includes only dm/messages/mail/message_search", () => {
    expect([...BACKFILLABLE_SOURCES].sort()).toEqual(["dm", "mail", "message_search", "messages"]);
  });
  it("isBackfillable true for the 4 supported", () => {
    for (const s of ["dm", "messages", "mail", "message_search"]) expect(isBackfillable(s)).toBe(true);
  });
  it("isBackfillable false for calendar/tasks/docs", () => {
    for (const s of ["calendar", "tasks", "docs"]) expect(isBackfillable(s)).toBe(false);
  });
});

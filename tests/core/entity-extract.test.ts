import { describe, expect, test } from "vitest";
import { extractQuickEntities } from "../../src/core/entity-extract";

describe("extractQuickEntities", () => {
  test("extracts email addresses", () => {
    const result = extractQuickEntities("Contact alice@example.com or bob@foo.org");
    expect(result).toContainEqual({ type: "email", value: "alice@example.com" });
    expect(result).toContainEqual({ type: "email", value: "bob@foo.org" });
  });

  test("extracts URLs", () => {
    const result = extractQuickEntities("See https://github.com/foo/bar and http://example.com/path?q=1");
    expect(result).toContainEqual({ type: "url", value: "https://github.com/foo/bar" });
    expect(result).toContainEqual({ type: "url", value: "http://example.com/path?q=1" });
  });

  test("extracts handles", () => {
    const result = extractQuickEntities("Ping @alice and @bob-dev");
    expect(result).toContainEqual({ type: "handle", value: "@alice" });
    expect(result).toContainEqual({ type: "handle", value: "@bob-dev" });
  });

  test("extracts hashtags including CJK", () => {
    const result = extractQuickEntities("Check #feishu and #飞书集成");
    expect(result).toContainEqual({ type: "hashtag", value: "#feishu" });
    expect(result).toContainEqual({ type: "hashtag", value: "#飞书集成" });
  });

  test("extracts phone numbers", () => {
    const result = extractQuickEntities("Call +86-138-0000-1234 or 021-12345678");
    expect(result.filter(e => e.type === "phone").length).toBeGreaterThanOrEqual(1);
  });

  test("extracts ticket IDs (12-15 digit numbers)", () => {
    const result = extractQuickEntities("Ticket 123456789012 is resolved");
    expect(result).toContainEqual({ type: "ticket_id", value: "123456789012" });
  });

  test("returns empty array for empty text", () => {
    expect(extractQuickEntities("")).toEqual([]);
  });

  test("deduplicates same (type, value) pairs", () => {
    const result = extractQuickEntities("Email alice@x.com and again alice@x.com");
    const emails = result.filter(e => e.type === "email" && e.value === "alice@x.com");
    expect(emails.length).toBe(1);
  });

  test("does not match email inside URL", () => {
    const result = extractQuickEntities("Visit https://user@example.com/path");
    const emails = result.filter(e => e.type === "email");
    expect(emails.length).toBe(0);
  });
});

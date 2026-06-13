import { describe, expect, test } from "vitest";
import { LlmJsonParseError, parseLlmJson } from "../../../../src/collectors/feishu/docs/llm-json";

describe("parseLlmJson", () => {
  test("plain JSON parses", () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  test("JSON wrapped in markdown code fences parses", () => {
    const input = "```json\n{\"a\":1}\n```";
    expect(parseLlmJson(input)).toEqual({ a: 1 });
  });

  test("JSON embedded in prose parses (first { to last })", () => {
    const input = 'Sure! Here you go: {"a":1,"b":[2,3]} — hope that helps';
    expect(parseLlmJson(input)).toEqual({ a: 1, b: [2, 3] });
  });

  test("unparseable input throws LlmJsonParseError", () => {
    expect(() => parseLlmJson("no json at all")).toThrow(LlmJsonParseError);
  });

  test("malformed braces throw LlmJsonParseError", () => {
    expect(() => parseLlmJson("{ not: valid json }")).toThrow(LlmJsonParseError);
  });
});

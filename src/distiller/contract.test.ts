import { describe, expect, it } from "vitest";
import {
  DistilledPayloadSchema,
  type DistilledSignal,
  KnowledgeSourceKindSchema,
  PreferenceCategorySchema,
  parsePayload,
  slugifyTopic,
} from "./contract.js";

// A minimal valid signal of each type. evidence references are validated
// structurally here; url-in-evidence cross-checking is exercised in msg-id.test.ts.
const baseFields = {
  topic: "Adopt Bun for tooling",
  what: "Team will use Bun instead of npm for the build toolchain.",
  entities: ["Bun"],
  authority: "user_confirmed" as const,
  evidence: [{ start: "msg-1", end: "msg-3" }],
  persistence_reason: "A durable stack decision the future reader needs.",
};

describe("DistilledSignal — discriminated union (spec §5)", () => {
  it("accepts a valid decision (public fields suffice)", () => {
    const sig = { type: "decision", ...baseFields };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).not.toThrow();
  });

  it("accepts a valid task with status + ISO due_date", () => {
    const sig = {
      type: "task",
      ...baseFields,
      topic: "Ship distiller",
      owner: "andre",
      due_date: "2026-08-01T00:00:00.000Z",
      status: "open",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).not.toThrow();
  });

  it("rejects a task with a non-ISO due_date", () => {
    const sig = { type: "task", ...baseFields, status: "open", due_date: "2026-08-01" };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).toThrow();
  });

  it("rejects a task with an invalid status enum", () => {
    const sig = { type: "task", ...baseFields, status: "pending" };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).toThrow();
  });

  it("requires reference.url", () => {
    const withUrl = {
      type: "reference",
      ...baseFields,
      url: "https://example.com/doc",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [withUrl] })).not.toThrow();

    const withoutUrl = { type: "reference", ...baseFields };
    expect(() => DistilledPayloadSchema.parse({ signals: [withoutUrl] })).toThrow();
  });

  it("preference.category must be a PreferenceCategory enum, not free text", () => {
    const good = {
      type: "preference",
      ...baseFields,
      subject: "editor",
      category: PreferenceCategorySchema.options[0],
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [good] })).not.toThrow();

    const bad = {
      type: "preference",
      ...baseFields,
      subject: "editor",
      category: "totally-made-up",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [bad] })).toThrow();
  });

  it("knowledge.source_kind must be a KnowledgeSourceKind enum; dates ISO 8601", () => {
    const good = {
      type: "knowledge",
      ...baseFields,
      source_kind: KnowledgeSourceKindSchema.options[0],
      valid_at: "2026-01-01T00:00:00.000Z",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [good] })).not.toThrow();

    const badKind = { type: "knowledge", ...baseFields, source_kind: "hearsay" };
    expect(() => DistilledPayloadSchema.parse({ signals: [badKind] })).toThrow();

    const badDate = {
      type: "knowledge",
      ...baseFields,
      source_kind: KnowledgeSourceKindSchema.options[0],
      valid_at: "2026-01-01",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [badDate] })).toThrow();
  });

  it("accepts a valid discovery with a subtype enum", () => {
    const sig = { type: "discovery", ...baseFields, subtype: "insight" };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).not.toThrow();

    const bad = { type: "discovery", ...baseFields, subtype: "epiphany" };
    expect(() => DistilledPayloadSchema.parse({ signals: [bad] })).toThrow();
  });

  it("accepts the three authority levels and rejects others", () => {
    for (const authority of ["user_confirmed", "assistant_proposed", "assistant_claimed"]) {
      const sig = { type: "decision", ...baseFields, authority };
      expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).not.toThrow();
    }
    const bad = { type: "decision", ...baseFields, authority: "verified_by_tool" };
    expect(() => DistilledPayloadSchema.parse({ signals: [bad] })).toThrow();
  });

  it("allows optional supersedes_topic and project", () => {
    const sig = {
      type: "decision",
      ...baseFields,
      project: "memkin",
      supersedes_topic: "Use npm",
    };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).not.toThrow();
  });

  it("has no open_items type (unified to task+status:open)", () => {
    const sig = { type: "open_items", ...baseFields };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).toThrow();
  });

  it("rejects an empty evidence array (every signal must cite messages)", () => {
    const sig = { type: "decision", ...baseFields, evidence: [] };
    expect(() => DistilledPayloadSchema.parse({ signals: [sig] })).toThrow();
  });
});

describe("payload-internal dedup: no duplicate (type, slugify(topic))", () => {
  it("rejects two signals with same type and slugified topic", () => {
    const a = { type: "decision", ...baseFields, topic: "Adopt Bun" };
    const b = { type: "decision", ...baseFields, topic: "adopt   bun" };
    // Same slug → collision → reject.
    expect(slugifyTopic("Adopt Bun")).toBe(slugifyTopic("adopt   bun"));
    const res = parsePayload({ signals: [a, b] });
    expect(res.ok).toBe(false);
  });

  it("allows same slugified topic across different types", () => {
    const dec = { type: "decision", ...baseFields, topic: "Bun" };
    const task = { type: "task", ...baseFields, topic: "Bun", status: "open" };
    const res = parsePayload({ signals: [dec, task] });
    expect(res.ok).toBe(true);
  });

  it("parsePayload returns typed signals on success", () => {
    const res = parsePayload({ signals: [{ type: "decision", ...baseFields }] });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const sigs: DistilledSignal[] = res.payload.signals;
      expect(sigs[0].type).toBe("decision");
    }
  });
});

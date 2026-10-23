import { z } from "zod";
import { InstantSchema, isDate, TimeSchema, TimezoneSchema, UNKNOWN_TIME } from "./temporal.js";

const text = z.string().trim().min(1).max(500);
export const IdSchema = z.number().int().positive();
const BirthdaySchema = z
  .object({
    calendar: z.enum(["gregorian", "lunar"]).default("gregorian"),
    year: z.number().int().min(1).max(9999).optional(),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31).optional(),
    leap_month: z.boolean().default(false),
  })
  .strict()
  .superRefine((b, ctx) => {
    if (
      (b.calendar === "gregorian" && b.leap_month) ||
      (b.calendar === "lunar" && (b.day ?? 1) > 30) ||
      (b.calendar === "gregorian" &&
        b.day !== undefined &&
        !isDate(
          `${String(b.year ?? 2000).padStart(4, "0")}-${String(b.month).padStart(2, "0")}-${String(b.day).padStart(2, "0")}`,
        ))
    )
      ctx.addIssue({ code: "custom", message: "Invalid birthday for its calendar" });
  });

export const ProfileSchema = z
  .object({
    name: text,
    aliases: z.array(text).max(50).default([]),
    birthday: BirthdaySchema.nullable().default(null),
    gender: z.string().trim().max(100).default(""),
    contacts: z
      .array(
        z
          .object({
            kind: z.enum(["phone", "email", "wechat", "other"]),
            value: text,
            label: z.string().max(200).default(""),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    addresses: z
      .array(
        z
          .object({
            label: z.string().max(200).default(""),
            value: text,
            valid_from: TimeSchema.optional(),
            valid_until: TimeSchema.optional(),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    notes: z.string().max(20000).default(""),
  })
  .strict();
export type PersonProfile = z.infer<typeof ProfileSchema>;
export const CreatePersonSchema = z
  .object({ profile: ProfileSchema, page_slug: text.optional() })
  .strict();
export const UpdatePersonSchema = z
  .object({ profile: ProfileSchema, expected_revision: IdSchema, reason: text })
  .strict();

export const CaptureSchema = z
  .object({
    content: z.string().min(1).max(100000),
    source: z.enum(["manual", "voice", "import"]).default("manual"),
    captured_at: InstantSchema,
    timezone: TimezoneSchema,
    external_id: text.optional(),
    person_ids: z.array(IdSchema).max(50).default([]),
  })
  .strict();
export type CaptureInput = z.infer<typeof CaptureSchema>;

const EvidenceSchema = z.object({ quote: z.string().min(1).max(10000) }).strict();
const interaction = z
  .object({
    kind: z.literal("interaction"),
    summary: text,
    detail: z.string().max(20000).default(""),
    people: z
      .array(z.object({ ref: text, role: z.enum(["participant", "mentioned"]) }).strict())
      .min(1)
      .max(50),
    topics: z.array(text).max(30).default([]),
    time: TimeSchema.default(UNKNOWN_TIME),
    status: z.enum(["happened", "planned", "cancelled"]).default("happened"),
    evidence: EvidenceSchema,
  })
  .strict();
const fact = z
  .object({
    kind: z.literal("fact"),
    subject: text,
    predicate: text,
    value: text,
    status: z.enum(["current", "past", "planned", "uncertain"]).default("uncertain"),
    valid_from: TimeSchema.default(UNKNOWN_TIME),
    valid_until: TimeSchema.default(UNKNOWN_TIME),
    evidence: EvidenceSchema,
  })
  .strict();
const relationship = z
  .object({
    kind: z.literal("relationship"),
    subject: text,
    object: text,
    relation: text,
    status: z.enum(["current", "past", "planned", "uncertain"]).default("uncertain"),
    valid_from: TimeSchema.default(UNKNOWN_TIME),
    valid_until: TimeSchema.default(UNKNOWN_TIME),
    evidence: EvidenceSchema,
  })
  .strict();
export const EntrySchema = z.discriminatedUnion("kind", [interaction, fact, relationship]);
export type EntryInput = z.infer<typeof EntrySchema>;
export const ProposalSchema = z
  .object({
    people: z
      .array(
        z
          .object({
            key: text,
            name: text,
            profile_patch: ProfileSchema.partial().optional(),
            evidence: EvidenceSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    entries: z.array(EntrySchema).min(1).max(100),
  })
  .strict()
  .superRefine((p, ctx) => {
    const keys = new Set(p.people.map((x) => x.key));
    if (keys.size !== p.people.length)
      ctx.addIssue({ code: "custom", message: "Person keys must be unique" });
    for (const person of p.people)
      if (person.profile_patch && !person.evidence)
        ctx.addIssue({ code: "custom", message: "Proposed profile fields need a source quote" });
    for (const entry of p.entries)
      for (const ref of entryRefs(entry))
        if (!keys.has(ref))
          ctx.addIssue({ code: "custom", message: `Unknown person reference: ${ref}` });
  });
export type ProposalInput = z.infer<typeof ProposalSchema>;
export const IdentitySchema = z.union([
  z
    .object({
      person_id: IdSchema,
      expected_revision: IdSchema,
      apply_profile: z.boolean().default(false),
    })
    .strict(),
  z.object({ new_person: ProfileSchema }).strict(),
]);
export const ApplySchema = z.object({ identities: z.record(IdentitySchema) }).strict();
export const CorrectionSchema = z
  .object({ entry: EntrySchema, expected_revision: IdSchema, reason: text })
  .strict();
export const TimelineSchema = z
  .object({
    person_id: IdSchema.optional(),
    axis: z.enum(["occurred", "captured"]).default("occurred"),
    from: z.string().optional(),
    to: z.string().optional(),
    topic: z.string().max(500).optional(),
    role: z.enum(["participant", "mentioned", "subject", "related"]).optional(),
    limit: z.number().int().min(1).max(200).default(100),
    offset: z.number().int().min(0).max(100000).default(0),
  })
  .strict();

export function entryRefs(entry: EntryInput): string[] {
  return entry.kind === "interaction"
    ? entry.people.map((p) => p.ref)
    : entry.kind === "relationship"
      ? [entry.subject, entry.object]
      : [entry.subject];
}

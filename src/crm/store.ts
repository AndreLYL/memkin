import { createHash, randomUUID } from "node:crypto";
import { rechunkTx } from "../store/chunks.js";
import type { SqlConn, SqlExecutor } from "../store/sql-executor.js";
import {
  ApplySchema,
  CaptureSchema,
  CorrectionSchema,
  CreatePersonSchema,
  type EntryInput,
  EntrySchema,
  entryRefs,
  IdSchema,
  type PersonProfile,
  type ProposalInput,
  ProposalSchema,
  TimelineSchema,
  UpdatePersonSchema,
} from "./schemas.js";
import { filterInstant, type MemoryTime, timeBounds } from "./temporal.js";

export class CrmError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID_ARGUMENT" | "UNAVAILABLE",
    message: string,
  ) {
    super(message);
  }
}
export interface Person {
  id: number;
  slug: string;
  profile: PersonProfile;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface SourceRecord {
  id: string;
  content: string;
  source: "manual" | "voice" | "import";
  captured_at: string;
  captured_at_input: string;
  timezone: string;
  external_id: string | null;
  ingested_at: string;
  person_ids: number[];
}
export interface MemoryEntry {
  id: string;
  record_id: string;
  proposal_id: string;
  kind: EntryInput["kind"];
  data: EntryInput;
  revision: number;
  created_at: string;
  updated_at: string;
  captured_at?: string;
  captured_at_input?: string;
  timezone?: string;
  ingested_at?: string;
}
export interface Proposal {
  id: string;
  record_id: string;
  data: ProposalInput;
  origin: "manual" | "ai";
  status: "pending" | "applied";
  result: { person_ids: number[]; entry_ids: string[] } | null;
}

function clean<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
function invalid(message: string): never {
  throw new CrmError("INVALID_ARGUMENT", message);
}
function assertEvidence(data: ProposalInput | EntryInput, record: SourceRecord): void {
  const entries = "entries" in data ? data.entries : [data];
  if ("people" in data && "entries" in data)
    for (const person of data.people) {
      if (
        person.profile_patch &&
        (!person.evidence || !record.content.includes(person.evidence.quote))
      )
        invalid("Proposed profile fields need an exact source quote");
    }
  for (const entry of entries) {
    if (!record.content.includes(entry.evidence.quote))
      invalid("Evidence quote must be an exact substring of the saved source");
    if (entry.kind === "interaction") {
      const roles = entry.people.map((p) => `${p.ref}:${p.role}`);
      if (unique(roles).length !== roles.length)
        invalid("Duplicate person and role in interaction");
    } else if (entry.valid_from.value && entry.valid_until.value) {
      const [start] = timeBounds(entry.valid_from);
      const [, end] = timeBounds(entry.valid_until);
      if (start && end && start >= end) invalid("Validity end must not precede validity start");
    }
  }
}

export class CrmStore {
  constructor(private readonly db: SqlExecutor) {}

  async listPeople(query = "", limit = 100, offset = 0): Promise<Person[]> {
    const result = await this.db.query<Person>(
      `SELECT c.person_id AS id,p.slug,c.profile,c.revision,c.created_at,c.updated_at
       FROM crm_people c JOIN pages p ON p.id=c.person_id
       WHERE $1='' OR c.profile->>'name' ILIKE $2 OR (c.profile->'aliases')::text ILIKE $2
       ORDER BY c.profile->>'name',c.person_id LIMIT $3 OFFSET $4`,
      [
        query,
        `%${query.replace(/[\\%_]/g, "\\$&")}%`,
        Math.max(1, Math.min(limit, 200)),
        Math.max(0, offset),
      ],
    );
    return clean(result.rows);
  }

  async getPerson(id: number, conn: SqlConn = this.db): Promise<Person> {
    IdSchema.parse(id);
    const result = await conn.query<Person>(
      `SELECT c.person_id AS id,p.slug,c.profile,c.revision,c.created_at,c.updated_at
       FROM crm_people c JOIN pages p ON p.id=c.person_id WHERE c.person_id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new CrmError("NOT_FOUND", "Person not found");
    return clean(result.rows[0]);
  }

  async createPerson(input: unknown): Promise<Person> {
    const data = CreatePersonSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const id = await this.createPersonTx(tx, data.profile, data.page_slug);
      await this.syncPeople(tx, [id]);
      return this.getPerson(id, tx);
    });
  }

  private async createPersonTx(
    tx: SqlConn,
    profile: PersonProfile,
    pageSlug?: string,
  ): Promise<number> {
    let id: number;
    if (pageSlug) {
      const page = await tx.query<{ id: number; type: string }>(
        "SELECT id,type FROM pages WHERE slug=$1 FOR UPDATE",
        [pageSlug],
      );
      if (!page.rows[0])
        throw new CrmError("NOT_FOUND", "Explicitly selected legacy person page not found");
      if (page.rows[0].type !== "person") invalid("Only a person page can be adopted");
      id = page.rows[0].id;
      if ((await tx.query("SELECT 1 FROM crm_people WHERE person_id=$1", [id])).rows.length)
        throw new CrmError("CONFLICT", "Page already has a CRM profile");
    } else {
      const slug = `people/${randomUUID()}`;
      const page = await tx.query<{ id: number }>(
        "INSERT INTO pages(slug,type,title) VALUES($1,'person',$2) RETURNING id",
        [slug, profile.name],
      );
      id = page.rows[0].id;
    }
    await tx.query("INSERT INTO crm_people(person_id,profile) VALUES($1,$2::jsonb)", [
      id,
      JSON.stringify(profile),
    ]);
    await tx.query(
      `INSERT INTO entity_handles(entity_type,scope,kind,value,canonical_slug,strength)
      SELECT 'person','global','slug',slug,slug,'strong' FROM pages WHERE id=$1
      ON CONFLICT DO NOTHING`,
      [id],
    );
    await this.audit(tx, "person", String(id), 1, null, profile, "Created person profile");
    return id;
  }

  async updatePerson(id: number, input: unknown): Promise<Person> {
    const data = UpdatePersonSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT person_id FROM crm_people WHERE person_id=$1 FOR UPDATE", [id]);
      const person = await this.getPerson(id, tx);
      if (person.revision !== data.expected_revision)
        throw new CrmError("CONFLICT", "Person changed; reload before saving");
      await tx.query(
        "UPDATE crm_people SET profile=$2::jsonb,revision=revision+1,updated_at=NOW() WHERE person_id=$1",
        [id, JSON.stringify(data.profile)],
      );
      await this.audit(
        tx,
        "person",
        String(id),
        person.revision + 1,
        person.profile,
        data.profile,
        data.reason,
      );
      await this.syncPeople(tx, [id]);
      return this.getPerson(id, tx);
    });
  }

  async capture(input: unknown): Promise<SourceRecord> {
    const data = CaptureSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const ids = unique(data.person_ids).sort((a, b) => a - b);
      for (const id of ids) await this.getPerson(id, tx);
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO crm_records(id,content,source,captured_at,captured_at_input,timezone,external_id)
         VALUES($1,$2,$3,$4::timestamptz,$5::text,$6,$7) ON CONFLICT(source,external_id) DO NOTHING RETURNING id`,
        [
          randomUUID(),
          data.content,
          data.source,
          data.captured_at,
          data.captured_at,
          data.timezone,
          data.external_id ?? null,
        ],
      );
      if (!inserted.rows[0]) {
        const previous = await tx.query<{ id: string }>(
          "SELECT id FROM crm_records WHERE source=$1 AND external_id=$2",
          [data.source, data.external_id],
        );
        const record = await this.getRecord(previous.rows[0].id, tx);
        if (
          record.content !== data.content ||
          record.captured_at_input !== data.captured_at ||
          record.timezone !== data.timezone ||
          JSON.stringify(record.person_ids) !== JSON.stringify(ids)
        )
          throw new CrmError(
            "CONFLICT",
            "External ID already identifies a different immutable source",
          );
        return record;
      }
      const id = inserted.rows[0].id;
      for (const person of ids)
        await tx.query("INSERT INTO crm_record_people(record_id,person_id) VALUES($1,$2)", [
          id,
          person,
        ]);
      return this.getRecord(id, tx);
    });
  }

  async getRecord(id: string, conn: SqlConn = this.db): Promise<SourceRecord> {
    const row = await conn.query<SourceRecord>(
      `SELECT r.*,COALESCE((SELECT jsonb_agg(person_id ORDER BY person_id) FROM crm_record_people WHERE record_id=r.id),'[]'::jsonb) AS person_ids
       FROM crm_records r WHERE r.id=$1`,
      [id],
    );
    if (!row.rows[0]) throw new CrmError("NOT_FOUND", "Source record not found");
    return clean(row.rows[0]);
  }

  async listRecords(personId?: number, limit = 100, offset = 0): Promise<SourceRecord[]> {
    const row = await this.db.query<{ id: string }>(
      `SELECT r.id FROM crm_records r WHERE $1::int IS NULL OR
       EXISTS(SELECT 1 FROM crm_record_people WHERE record_id=r.id AND person_id=$1) OR
       EXISTS(SELECT 1 FROM crm_entries e JOIN crm_entry_people ep ON ep.entry_id=e.id WHERE e.record_id=r.id AND ep.person_id=$1)
       ORDER BY r.captured_at DESC,r.id DESC LIMIT $2 OFFSET $3`,
      [personId ?? null, Math.max(1, Math.min(limit, 200)), Math.max(0, offset)],
    );
    return Promise.all(row.rows.map((r) => this.getRecord(r.id)));
  }

  async saveProposal(
    recordId: string,
    input: unknown,
    origin: "manual" | "ai" = "manual",
  ): Promise<Proposal> {
    const data = ProposalSchema.parse(input);
    const record = await this.getRecord(recordId);
    assertEvidence(data, record);
    const result = await this.db.query<Proposal>(
      "INSERT INTO crm_proposals(id,record_id,data,origin) VALUES($1,$2,$3::jsonb,$4) RETURNING *",
      [randomUUID(), recordId, JSON.stringify(data), origin],
    );
    return clean(result.rows[0]);
  }

  async listProposals(recordId: string): Promise<Proposal[]> {
    await this.getRecord(recordId);
    return clean(
      (
        await this.db.query<Proposal>(
          "SELECT * FROM crm_proposals WHERE record_id=$1 ORDER BY created_at,id",
          [recordId],
        )
      ).rows,
    );
  }

  async applyProposal(
    id: string,
    input: unknown,
  ): Promise<{ person_ids: number[]; entry_ids: string[] }> {
    const args = ApplySchema.parse(input);
    return this.db.transaction(async (tx) => {
      const result = await tx.query<Proposal>(
        "SELECT * FROM crm_proposals WHERE id=$1 FOR UPDATE",
        [id],
      );
      const proposal = result.rows[0];
      if (!proposal) throw new CrmError("NOT_FOUND", "Proposal not found");
      if (proposal.status === "applied" && proposal.result) return clean(proposal.result);
      const data = ProposalSchema.parse(proposal.data);
      const record = await this.getRecord(proposal.record_id, tx);
      assertEvidence(data, record);
      if (Object.keys(args.identities).length !== data.people.length)
        invalid("Confirm exactly one identity for every proposed person");
      for (const person of data.people)
        if (!Object.hasOwn(args.identities, person.key))
          invalid(`Confirm identity for ${person.name}`);
      const existingIds = unique(
        Object.values(args.identities).flatMap((x) => ("person_id" in x ? [x.person_id] : [])),
      ).sort((a, b) => a - b);
      for (const personId of existingIds)
        await tx.query("SELECT person_id FROM crm_people WHERE person_id=$1 FOR UPDATE", [
          personId,
        ]);
      const mapping: Record<string, number> = Object.create(null);
      for (const person of data.people) {
        const identity = args.identities[person.key];
        if ("person_id" in identity) {
          const current = await this.getPerson(identity.person_id, tx);
          if (current.revision !== identity.expected_revision)
            throw new CrmError(
              "CONFLICT",
              `Profile for ${current.profile.name} changed; review the proposal again`,
            );
          if (identity.apply_profile && person.profile_patch) {
            const profile = CreatePersonSchema.shape.profile.parse({
              ...current.profile,
              ...person.profile_patch,
            });
            await tx.query(
              "UPDATE crm_people SET profile=$2::jsonb,revision=revision+1,updated_at=NOW() WHERE person_id=$1",
              [current.id, JSON.stringify(profile)],
            );
            await this.audit(
              tx,
              "person",
              String(current.id),
              current.revision + 1,
              current.profile,
              profile,
              `Confirmed profile fields from source ${record.id}: ${person.evidence?.quote}`,
            );
          }
          mapping[person.key] = current.id;
        } else mapping[person.key] = await this.createPersonTx(tx, identity.new_person);
      }
      const entries: string[] = [];
      for (const entry of data.entries) {
        const resolved = this.resolveEntry(entry, mapping, record.timezone);
        assertEvidence(resolved, record);
        if (resolved.kind === "relationship" && resolved.subject === resolved.object)
          invalid("Choose two distinct people for a relationship");
        const entryId = randomUUID();
        const time = resolved.kind === "interaction" ? resolved.time : resolved.valid_from;
        const [start, end] = timeBounds(time);
        await tx.query(
          `INSERT INTO crm_entries(id,record_id,proposal_id,kind,data,occurred_start,occurred_end)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz,$7::timestamptz)`,
          [entryId, record.id, proposal.id, resolved.kind, JSON.stringify(resolved), start, end],
        );
        await this.linkEntry(tx, entryId, resolved);
        await this.audit(tx, "entry", entryId, 1, null, resolved, "Confirmed source proposal");
        entries.push(entryId);
      }
      const applied = { person_ids: unique(Object.values(mapping)), entry_ids: entries };
      await tx.query(
        "UPDATE crm_proposals SET status='applied',result=$2::jsonb,applied_at=NOW() WHERE id=$1",
        [id, JSON.stringify(applied)],
      );
      await this.syncPeople(tx, applied.person_ids);
      return applied;
    });
  }

  private resolveEntry(
    entry: EntryInput,
    mapping: Record<string, number>,
    timezone: string,
  ): EntryInput {
    const ref = (key: string) => String(mapping[key] ?? invalid(`Missing identity ${key}`));
    const zoned = (time: MemoryTime) => ({ ...time, timezone: time.timezone ?? timezone });
    if (entry.kind === "interaction")
      return {
        ...entry,
        people: entry.people.map((p) => ({ ...p, ref: ref(p.ref) })),
        time: zoned(entry.time),
      };
    const common = {
      ...entry,
      subject: ref(entry.subject),
      valid_from: zoned(entry.valid_from),
      valid_until: zoned(entry.valid_until),
    };
    return entry.kind === "relationship"
      ? ({
          ...common,
          kind: "relationship",
          object: ref(entry.object),
          relation: entry.relation,
        } as EntryInput)
      : common;
  }

  private async linkEntry(tx: SqlConn, id: string, entry: EntryInput): Promise<void> {
    const people =
      entry.kind === "interaction"
        ? entry.people
        : [
            { ref: entry.subject, role: "subject" },
            ...(entry.kind === "relationship" ? [{ ref: entry.object, role: "related" }] : []),
          ];
    for (const p of people) {
      const personId = Number(p.ref);
      if (!Number.isSafeInteger(personId) || personId <= 0)
        invalid("Corrections reference stable numeric person IDs");
      await this.getPerson(personId, tx);
      await tx.query(
        "INSERT INTO crm_entry_people(entry_id,person_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [id, personId, p.role],
      );
    }
  }

  async getEntry(id: string, conn: SqlConn = this.db): Promise<MemoryEntry> {
    const result = await conn.query<MemoryEntry>("SELECT * FROM crm_entries WHERE id=$1", [id]);
    if (!result.rows[0]) throw new CrmError("NOT_FOUND", "Entry not found");
    return clean(result.rows[0]);
  }

  async correctEntry(id: string, input: unknown): Promise<MemoryEntry> {
    const args = CorrectionSchema.parse(input);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM crm_entries WHERE id=$1 FOR UPDATE", [id]);
      const before = await this.getEntry(id, tx);
      if (before.revision !== args.expected_revision)
        throw new CrmError("CONFLICT", "Entry changed; reload before correcting");
      if (before.kind !== args.entry.kind) invalid("Correction must keep the original entry kind");
      const record = await this.getRecord(before.record_id, tx);
      const entry = EntrySchema.parse(args.entry);
      assertEvidence(entry, record);
      const people = unique([...entryRefs(before.data), ...entryRefs(entry)].map(Number)).sort(
        (a, b) => a - b,
      );
      for (const personId of people) {
        IdSchema.parse(personId);
        await tx.query("SELECT person_id FROM crm_people WHERE person_id=$1 FOR UPDATE", [
          personId,
        ]);
        await this.getPerson(personId, tx);
      }
      const mapping = Object.fromEntries(entryRefs(entry).map((ref) => [ref, Number(ref)]));
      const resolved = this.resolveEntry(entry, mapping, record.timezone);
      assertEvidence(resolved, record);
      if (resolved.kind === "relationship" && resolved.subject === resolved.object)
        invalid("Choose two distinct people for a relationship");
      const [start, end] = timeBounds(
        resolved.kind === "interaction" ? resolved.time : resolved.valid_from,
      );
      await tx.query(
        "UPDATE crm_entries SET data=$2::jsonb,occurred_start=$3::timestamptz,occurred_end=$4::timestamptz,revision=revision+1,updated_at=NOW() WHERE id=$1",
        [id, JSON.stringify(resolved), start, end],
      );
      await tx.query("DELETE FROM crm_entry_people WHERE entry_id=$1", [id]);
      await this.linkEntry(tx, id, resolved);
      await this.audit(tx, "entry", id, before.revision + 1, before.data, resolved, args.reason);
      await this.syncPeople(tx, people);
      return this.getEntry(id, tx);
    });
  }

  async timeline(input: unknown = {}): Promise<MemoryEntry[]> {
    const args = TimelineSchema.parse(input);
    const params: unknown[] = [];
    const conditions: string[] = [];
    const add = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (args.person_id)
      conditions.push(
        `EXISTS(SELECT 1 FROM crm_entry_people ep WHERE ep.entry_id=e.id AND ep.person_id=${add(args.person_id)}${args.role ? ` AND ep.role=${add(args.role)}` : ""})`,
      );
    else if (args.role)
      conditions.push(
        `EXISTS(SELECT 1 FROM crm_entry_people ep WHERE ep.entry_id=e.id AND ep.role=${add(args.role)})`,
      );
    if (args.topic) conditions.push(`e.data->'topics' ? ${add(args.topic)}`);
    const time = args.axis === "captured" ? "r.captured_at" : "e.occurred_start";
    if (args.from)
      conditions.push(
        args.axis === "captured"
          ? `${time}>=${add(filterInstant(args.from))}::timestamptz`
          : `e.occurred_end>${add(filterInstant(args.from))}::timestamptz`,
      );
    if (args.to) conditions.push(`${time}<${add(filterInstant(args.to, true))}::timestamptz`);
    if (
      args.from &&
      args.to &&
      Date.parse(filterInstant(args.from)) >= Date.parse(filterInstant(args.to, true))
    )
      invalid("from must precede to");
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.db.query<MemoryEntry>(
      `SELECT e.*,r.captured_at,r.captured_at_input,r.timezone,r.ingested_at
       FROM crm_entries e JOIN crm_records r ON r.id=e.record_id ${where}
       ORDER BY ${time} DESC NULLS LAST,e.id DESC LIMIT ${add(args.limit)} OFFSET ${add(args.offset)}`,
      params,
    );
    return clean(result.rows);
  }

  async history(entityType: "person" | "entry", id: string): Promise<unknown[]> {
    return clean(
      (
        await this.db.query(
          "SELECT * FROM crm_revisions WHERE entity_type=$1 AND entity_id=$2 ORDER BY revision",
          [entityType, id],
        )
      ).rows,
    );
  }

  private async audit(
    tx: SqlConn,
    type: string,
    id: string,
    revision: number,
    before: unknown,
    after: unknown,
    reason: string,
  ): Promise<void> {
    await tx.query(
      "INSERT INTO crm_revisions(entity_type,entity_id,revision,before_data,after_data,reason) VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6)",
      [
        type,
        id,
        revision,
        before === null ? null : JSON.stringify(before),
        JSON.stringify(after),
        reason,
      ],
    );
  }

  private async syncPeople(tx: SqlConn, ids: number[]): Promise<void> {
    await tx.query("SELECT set_config('memkin.crm_write','on',true)");
    for (const id of unique(ids).sort((a, b) => a - b)) {
      const person = await this.getPerson(id, tx);
      const result = await tx.query<MemoryEntry & { captured_at_input: string }>(
        `SELECT e.*,r.captured_at_input FROM crm_entries e JOIN crm_records r ON r.id=e.record_id
         WHERE EXISTS(SELECT 1 FROM crm_entry_people ep WHERE ep.entry_id=e.id AND ep.person_id=$1)
         ORDER BY e.occurred_start DESC NULLS LAST,e.id`,
        [id],
      );
      const p = person.profile;
      const body = [
        `## ${p.name}`,
        `Person ID: ${id}`,
        `Aliases: ${p.aliases.join(", ")}`,
        ...(p.birthday ? [`Birthday: ${JSON.stringify(p.birthday)}`] : []),
        `Gender: ${p.gender}`,
        ...p.contacts.map((c) => `${c.kind} (${c.label}): ${c.value}`),
        ...p.addresses.map(
          (a) =>
            `Address (${a.label}): ${a.value}; validity: ${JSON.stringify({ from: a.valid_from, until: a.valid_until })}`,
        ),
        p.notes,
        "### Memories",
        ...result.rows.map((e) => {
          const d = e.data;
          const summary =
            d.kind === "interaction"
              ? `${d.status}: ${d.summary}; ${d.detail}; topics: ${d.topics.join(", ")}; people: ${d.people.map((p) => `${p.ref} (${p.role})`).join(", ")}; event time: ${JSON.stringify(d.time)}`
              : `${d.status}: ${d.kind === "fact" ? `${d.predicate}: ${d.value}` : `${d.subject} ${d.relation} ${d.object}`}; valid from: ${JSON.stringify(d.valid_from)}; valid until: ${JSON.stringify(d.valid_until)}`;
          return `- ${summary}; captured: ${e.captured_at_input}; source: /records/${e.record_id}; quote: ${d.evidence.quote}`;
        }),
      ]
        .map((line) => line.replaceAll("<!-- memkin:crm:", "&lt;!-- memkin:crm:"))
        .join("\n");
      const generated = `<!-- memkin:crm:start -->\n${body}\n<!-- memkin:crm:end -->`;
      const page = await tx.query<{ compiled_truth: string }>(
        "SELECT compiled_truth FROM pages WHERE id=$1 FOR UPDATE",
        [id],
      );
      const old = page.rows[0].compiled_truth;
      const block = /<!-- memkin:crm:start -->[\s\S]*?<!-- memkin:crm:end -->/;
      const combined = block.test(old)
        ? old.replace(block, () => generated)
        : `${old}\n\n${generated}`.trim();
      await tx.query(
        "UPDATE pages SET type='person',title=$2,compiled_truth=$3,content_hash=$4,halflife_days=NULL,expires_at=NULL,updated_at=NOW() WHERE id=$1",
        [id, p.name, combined, createHash("sha256").update(combined).digest("hex")],
      );
      await rechunkTx(tx, id, combined);
    }
    await this.rebuildGraph(tx, ids);
  }

  private async rebuildGraph(tx: SqlConn, ids: number[]): Promise<void> {
    await tx.query(
      "DELETE FROM links WHERE left(link_type,4)='crm:' AND (from_page_id=ANY($1::int[]) OR to_page_id=ANY($1::int[]))",
      [ids],
    );
    const entries = await tx.query<
      MemoryEntry & { source_content: string; captured_at_input: string }
    >(
      `SELECT e.*,r.content AS source_content,r.captured_at_input FROM crm_entries e JOIN crm_records r ON r.id=e.record_id WHERE
      EXISTS(SELECT 1 FROM crm_entry_people ep WHERE ep.entry_id=e.id AND ep.person_id=ANY($1::int[])) ORDER BY e.created_at,e.id`,
      [ids],
    );
    for (const e of entries.rows) {
      const d = e.data;
      let edges: [number, number, string][] = [];
      if (d.kind === "relationship")
        edges = [
          [Number(d.subject), Number(d.object), `crm:relationship:${d.status}:${d.relation}`],
        ];
      if (d.kind === "interaction") {
        const participants = d.people
          .filter((p) => p.role === "participant")
          .map((p) => Number(p.ref));
        edges = participants.flatMap((a) =>
          participants
            .filter((b) => b !== a)
            .map(
              (b) =>
                [
                  a,
                  b,
                  d.status === "happened" ? "crm:interaction" : `crm:interaction:${d.status}`,
                ] as [number, number, string],
            ),
        );
      }
      for (const [from, to, type] of edges) {
        if (from === to || (!ids.includes(from) && !ids.includes(to))) continue;
        await tx.query(
          `INSERT INTO links(from_page_id,to_page_id,link_type,context,provenance,source_hash)
          VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(from_page_id,to_page_id,link_type)
          DO UPDATE SET context=EXCLUDED.context,provenance=EXCLUDED.provenance,source_hash=EXCLUDED.source_hash`,
          [
            from,
            to,
            type,
            JSON.stringify(d),
            JSON.stringify({
              platform: "crm",
              channel: `records/${e.record_id}`,
              timestamp: e.captured_at_input,
              raw_hash: createHash("sha256").update(e.source_content).digest("hex"),
              crm_entry_id: e.id,
              record_id: e.record_id,
              quote: d.evidence.quote,
            }),
            `crm:${e.id}`,
          ],
        );
      }
    }
  }
}

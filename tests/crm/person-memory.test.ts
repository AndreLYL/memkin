import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IdentityResolver } from "../../src/core/identity-resolver.js";
import { PersonIdentityStore } from "../../src/core/person-identity.js";
import { proposeRecord } from "../../src/crm/extract.js";
import { ProfileSchema, ProposalSchema } from "../../src/crm/schemas.js";
import { CrmStore, type Person } from "../../src/crm/store.js";
import { TimeSchema, timeBounds } from "../../src/crm/temporal.js";
import { Database } from "../../src/store/database.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";

describe("structured person memory", () => {
  let db: Database;
  let store: CrmStore;
  beforeAll(async () => {
    db = await Database.create(undefined, { embeddingDimensions: 768 });
    store = new CrmStore(db.executor);
  });
  afterAll(async () => {
    await db.close();
  });
  const person = (name: string) => store.createPerson({ profile: { name } });
  const capture = (ids: number[] = [], external_id?: string) =>
    store.capture({
      content: "小林昨天和我聊了工作，也提到小周，下个月准备搬家。",
      source: "voice",
      captured_at: "2026-10-03T19:07:00+08:00",
      timezone: "Asia/Shanghai",
      person_ids: ids,
      ...(external_id ? { external_id } : {}),
    });
  const interaction = () => ({
    kind: "interaction" as const,
    summary: "聊了工作",
    people: [{ ref: "a", role: "participant" as const }],
    topics: ["工作", "搬家"],
    time: { value: "2026-10-02", precision: "day" as const },
    status: "happened" as const,
    evidence: { quote: "昨天和我聊了工作" },
  });
  const mapping = (p: Person) => ({ a: { person_id: p.id, expected_revision: p.revision } });
  const proposal = (p: Person) => ({
    people: [{ key: "a", name: p.profile.name }],
    entries: [interaction()],
  });

  it("keeps namesakes distinct, including aliases and yearless birthday", async () => {
    const a = await store.createPerson({
      profile: {
        name: "同名测试",
        aliases: ["林林"],
        birthday: { month: 6, day: 12 },
        contacts: [{ kind: "phone", value: "13800001234" }],
      },
    });
    const b = await person("同名测试");
    expect(a.id).not.toBe(b.id);
    expect(a.slug).not.toBe(b.slug);
    expect(a.profile.birthday).toMatchObject({ month: 6, day: 12 });
    expect(a.profile.birthday?.year).toBeUndefined();
    expect((await store.listPeople("林林"))[0].id).toBe(a.id);
  });

  it("validates Gregorian and lunar birthday precision", () => {
    expect(ProfileSchema.safeParse({ name: "x", birthday: { month: 2, day: 29 } }).success).toBe(
      true,
    );
    expect(
      ProfileSchema.safeParse({ name: "x", birthday: { year: 2025, month: 2, day: 29 } }).success,
    ).toBe(false);
    expect(
      ProfileSchema.safeParse({
        name: "x",
        birthday: { calendar: "lunar", month: 4, day: 30, leap_month: true },
      }).success,
    ).toBe(true);
    expect(
      ProfileSchema.safeParse({ name: "x", birthday: { calendar: "lunar", month: 4, day: 31 } })
        .success,
    ).toBe(false);
  });

  it("preserves original capture representation and uses ingestion independently", async () => {
    const source = await capture();
    expect(source.captured_at_input).toBe("2026-10-03T19:07:00+08:00");
    expect(source.captured_at).toBe("2026-10-03T11:07:00.000Z");
    expect(source.timezone).toBe("Asia/Shanghai");
    expect(source.ingested_at).not.toBe(source.captured_at);
    await expect(proposeRecord(store, source.id)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await store.getRecord(source.id)).content).toBe(source.content);
  });

  it("imports idempotently and rejects conflicting external IDs", async () => {
    const a = await capture([], "recording-card:001");
    const b = await capture([], "recording-card:001");
    expect(a.id).toBe(b.id);
    await expect(
      store.capture({
        ...a,
        external_id: "recording-card:001",
        captured_at: a.captured_at_input,
        content: "changed",
      }),
    ).rejects.toThrow();
    await expect(
      store.capture({
        content: "changed",
        source: "voice",
        captured_at: a.captured_at_input,
        timezone: a.timezone,
        external_id: "recording-card:001",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("makes original sources and audit rows immutable at the database boundary", async () => {
    const p = await person("不可变测试");
    const r = await capture();
    await expect(
      db.executor.query("UPDATE crm_records SET content='changed' WHERE id=$1", [r.id]),
    ).rejects.toThrow(/immutable/);
    await expect(db.executor.query("DELETE FROM crm_records WHERE id=$1", [r.id])).rejects.toThrow(
      /immutable/,
    );
    await expect(
      db.executor.query("DELETE FROM crm_revisions WHERE entity_type='person' AND entity_id=$1", [
        String(p.id),
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it("applies reviewed proposals once and retains source quotes", async () => {
    const p = await person("确认建议");
    const r = await capture();
    const q = await store.saveProposal(r.id, proposal(p));
    expect(await store.timeline({ person_id: p.id })).toHaveLength(0);
    const applied = await store.applyProposal(q.id, { identities: mapping(p) });
    expect(await store.applyProposal(q.id, { identities: {} })).toEqual(applied);
    const entries = await store.timeline({ person_id: p.id });
    expect(entries).toHaveLength(1);
    expect(entries[0].data).toMatchObject({
      time: { value: "2026-10-02", precision: "day", timezone: "Asia/Shanghai" },
      people: [{ ref: String(p.id), role: "participant" }],
    });
    expect((await store.getRecord(r.id)).content).toBe(r.content);
    expect(await store.history("entry", applied.entry_ids[0])).toHaveLength(1);
  });

  it("rejects invented evidence and unknown person references", async () => {
    const p = await person("证据校验");
    const r = await capture();
    await expect(
      store.saveProposal(r.id, {
        ...proposal(p),
        entries: [{ ...interaction(), evidence: { quote: "编造的内容" } }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(
      ProposalSchema.safeParse({
        people: [{ key: "a", name: "a" }],
        entries: [{ ...interaction(), people: [{ ref: "missing", role: "participant" }] }],
      }).success,
    ).toBe(false);
  });

  it("rejects stale profiles and missing identity decisions", async () => {
    const p = await person("修订并发");
    const r = await capture();
    const q = await store.saveProposal(r.id, proposal(p));
    await expect(store.applyProposal(q.id, { identities: {} })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    const updated = await store.updatePerson(p.id, {
      profile: { ...p.profile, name: "修订并发新姓名" },
      expected_revision: 1,
      reason: "更正姓名",
    });
    expect(updated.revision).toBe(2);
    await expect(store.applyProposal(q.id, { identities: mapping(p) })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      store.updatePerson(p.id, { profile: p.profile, expected_revision: 1, reason: "旧数据" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.history("person", String(p.id))).toHaveLength(2);
  });

  it("rolls back newly created people when any part of application fails", async () => {
    const r = await capture();
    const q = await store.saveProposal(r.id, {
      people: [
        { key: "a", name: "事务新建" },
        { key: "b", name: "同一个人" },
      ],
      entries: [
        {
          kind: "relationship",
          subject: "a",
          object: "b",
          relation: "朋友",
          evidence: { quote: "小林" },
        },
      ],
    });
    const p = await person("事务已有");
    const q2 = await store.saveProposal(r.id, {
      people: [
        { key: "a", name: "事务回滚独有名字" },
        { key: "b", name: "不存在" },
      ],
      entries: [interaction()],
    });
    await expect(
      store.applyProposal(q2.id, {
        identities: {
          a: { new_person: { name: "事务回滚独有名字" } },
          b: { person_id: 2147483647, expected_revision: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await store.listPeople("事务回滚独有名字")).toHaveLength(0);
    await expect(
      store.applyProposal(q.id, {
        identities: {
          a: { person_id: p.id, expected_revision: 1 },
          b: { person_id: p.id, expected_revision: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await store.listProposals(r.id)).every((p) => p.status === "pending")).toBe(true);
  });

  it("separates capture and event timelines and supports topics and roles", async () => {
    const a = await person("时间线参与者");
    const b = await person("时间线提及者");
    const r = await capture();
    const q = await store.saveProposal(r.id, {
      people: [
        { key: "a", name: "a" },
        { key: "b", name: "b" },
      ],
      entries: [
        {
          ...interaction(),
          people: [
            { ref: "a", role: "participant" },
            { ref: "b", role: "mentioned" },
          ],
        },
      ],
    });
    await store.applyProposal(q.id, {
      identities: { ...mapping(a), b: { person_id: b.id, expected_revision: 1 } },
    });
    expect(
      await store.timeline({ person_id: a.id, from: "2026-10-03", to: "2026-10-03" }),
    ).toHaveLength(0);
    expect(
      await store.timeline({
        person_id: a.id,
        axis: "captured",
        from: "2026-10-03",
        to: "2026-10-03",
        topic: "工作",
      }),
    ).toHaveLength(1);
    expect(
      await store.timeline({
        person_id: a.id,
        from: "2026-10-02T00:00:00+08:00",
        to: "2026-10-03T00:00:00+08:00",
      }),
    ).toHaveLength(1);
    expect(await store.timeline({ person_id: b.id, role: "participant" })).toHaveLength(0);
    expect(await store.timeline({ person_id: b.id, role: "mentioned" })).toHaveLength(1);
    expect(await store.timeline({ person_id: a.id, topic: "not-a-topic" })).toHaveLength(0);
  });

  it("keeps unknown event dates unknown, including bounded searches", async () => {
    const p = await person("未知事件时间");
    const r = await capture();
    const q = await store.saveProposal(r.id, {
      people: [{ key: "a", name: "a" }],
      entries: [{ ...interaction(), time: { value: null, precision: "unknown" } }],
    });
    await store.applyProposal(q.id, { identities: mapping(p) });
    expect(await store.timeline({ person_id: p.id })).toHaveLength(1);
    expect(await store.timeline({ person_id: p.id, from: "2020-01-01" })).toHaveLength(0);
    expect(
      await store.timeline({ person_id: p.id, axis: "captured", from: "2020-01-01" }),
    ).toHaveLength(1);
  });

  it("preserves plans without promoting them to current profile addresses", async () => {
    const p = await person("计划搬家");
    const r = await capture();
    const q = await store.saveProposal(r.id, {
      people: [{ key: "a", name: "a" }],
      entries: [
        {
          kind: "fact",
          subject: "a",
          predicate: "住址",
          value: "杭州",
          status: "planned",
          valid_from: { value: "2026-11", precision: "month" },
          evidence: { quote: "下个月准备搬家" },
        },
      ],
    });
    await store.applyProposal(q.id, { identities: mapping(p) });
    expect((await store.getPerson(p.id)).profile.addresses).toEqual([]);
    expect((await store.timeline({ person_id: p.id }))[0].data).toMatchObject({
      status: "planned",
      valid_from: { value: "2026-11", precision: "month" },
    });
    const page = await new PageStore(db.executor).getPage(p.slug);
    expect(page?.compiled_truth).toContain("planned");
    expect(page?.compiled_truth).toContain(r.id);
  });

  it("corrections rebuild person associations, graph and searchable projections", async () => {
    const a = await person("更正关联甲");
    const b = await person("更正关联乙");
    const c = await person("更正关联丙");
    const r = await capture([a.id]);
    const q = await store.saveProposal(r.id, {
      people: [
        { key: "a", name: "a" },
        { key: "b", name: "b" },
      ],
      entries: [
        {
          ...interaction(),
          people: [
            { ref: "a", role: "participant" },
            { ref: "b", role: "participant" },
          ],
        },
      ],
    });
    const applied = await store.applyProposal(q.id, {
      identities: { ...mapping(a), b: { person_id: b.id, expected_revision: 1 } },
    });
    const first = await store.getEntry(applied.entry_ids[0]);
    expect(
      (await new GraphStore(db.executor).getLinks(a.slug)).some(
        (x) => x.link_type === "crm:interaction",
      ),
    ).toBe(true);
    if (first.data.kind !== "interaction") throw new Error("wrong fixture");
    const corrected = await store.correctEntry(first.id, {
      entry: { ...first.data, people: [{ ref: String(c.id), role: "participant" }] },
      expected_revision: 1,
      reason: "认错了参与者",
    });
    expect(corrected.revision).toBe(2);
    expect(await store.timeline({ person_id: a.id })).toHaveLength(0);
    expect(await store.timeline({ person_id: b.id })).toHaveLength(0);
    expect(await store.timeline({ person_id: c.id })).toHaveLength(1);
    expect(
      (await new GraphStore(db.executor).getLinks(a.slug)).some((x) =>
        x.link_type.startsWith("crm:"),
      ),
    ).toBe(false);
    expect(await store.listRecords(a.id)).toHaveLength(1); // explicit capture association survives
    expect(await store.listRecords(b.id)).toHaveLength(0);
    expect(await store.listRecords(c.id)).toHaveLength(1);
    expect((await new PageStore(db.executor).getPage(a.slug))?.compiled_truth).not.toContain(
      first.id,
    );
    expect(await store.history("entry", first.id)).toHaveLength(2);
    await expect(
      store.correctEntry(first.id, {
        entry: corrected.data,
        expected_revision: 1,
        reason: "stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("protects generated pages while preserving handwritten notes", async () => {
    const pages = new PageStore(db.executor);
    await pages.putPage(
      "people/crm-legacy-notes",
      "---\ntitle: Legacy\ntype: person\n---\n我的手写备注",
    );
    const p = await store.createPerson({
      page_slug: "people/crm-legacy-notes",
      profile: { name: "Legacy" },
    });
    expect((await pages.getPage(p.slug))?.compiled_truth).toContain("我的手写备注");
    await expect(
      pages.putPage(p.slug, "---\ntitle: Legacy\ntype: person\n---\n覆盖结构化数据"),
    ).rejects.toThrow(/CRM|generated/);
    await expect(pages.deletePage(p.slug)).rejects.toThrow(/CRM/);
    await pages.putPage("notes/unrelated-delete", "---\ntitle: Note\ntype: note\n---\nbody");
    await pages.deletePage("notes/unrelated-delete");
    expect(await pages.getPage("notes/unrelated-delete")).toBeNull();
    const identity = new PersonIdentityStore(db.executor, { pages });
    await identity.recanonicalize(p.slug, "people/crm-renamed");
    expect((await store.getPerson(p.id)).slug).toBe("people/crm-renamed");
    await expect(identity.merge("people/crm-renamed", "people/crm-renamed-other")).rejects.toThrow(
      /CRM/,
    );
  });

  it("does not let legacy name handles, caches or pinyin silently select CRM people", async () => {
    const pages = new PageStore(db.executor);
    const identity = new PersonIdentityStore(db.executor, { pages });
    await pages.putPage("person/zhang-san-crm-test", "---\ntitle: 张三\ntype: person\n---\nlegacy");
    const p = await store.createPerson({
      page_slug: "person/zhang-san-crm-test",
      profile: { name: "张三" },
    });
    await identity.addAlias(p.slug, "name", "张三");
    expect(await identity.resolveForExtraction("张三", "person/new-unrelated")).toBeNull();
    expect(await identity.resolveForExtraction("张三", p.slug)).toBe(p.slug);
    await db.executor.query(
      "INSERT INTO identity_cache(platform,external_id,display_name) VALUES('canonical','张三',$1)",
      [p.slug],
    );
    const resolver = new IdentityResolver(db.executor);
    const resolved = await resolver.canonicalizePersonSlug("张三", "person/new-unrelated");
    expect(resolved.slug).not.toBe(p.slug);
  });

  it("keeps source delimiter text from breaking generated person blocks", async () => {
    const p = await person("原文包含标记");
    const content = "聊天原文 <!-- memkin:crm:end --> 之后仍然是原话";
    const r = await store.capture({
      content,
      captured_at: "2026-10-03T19:07:00+08:00",
      timezone: "Asia/Shanghai",
    });
    const q = await store.saveProposal(r.id, {
      people: [{ key: "a", name: p.profile.name }],
      entries: [{ ...interaction(), evidence: { quote: content } }],
    });
    await store.applyProposal(q.id, { identities: mapping(p) });
    await store.updatePerson(p.id, {
      profile: { ...p.profile, notes: "更新备注" },
      expected_revision: 1,
      reason: "检查视图重建",
    });
    const page = await new PageStore(db.executor).getPage(p.slug);
    expect(page?.compiled_truth.match(/<!-- memkin:crm:start -->/g)).toHaveLength(1);
    expect(page?.compiled_truth.match(/<!-- memkin:crm:end -->/g)).toHaveLength(1);
    expect(page?.compiled_truth.match(/聊天原文/g)).toHaveLength(1);
    expect((await store.getRecord(r.id)).content).toBe(content);
  });

  it("labels planned relationships and refuses self-relationships during correction", async () => {
    const a = await person("关系状态甲");
    const b = await person("关系状态乙");
    const r = await capture();
    const q = await store.saveProposal(r.id, {
      people: [
        { key: "a", name: "a" },
        { key: "b", name: "b" },
      ],
      entries: [
        {
          kind: "relationship",
          subject: "a",
          object: "b",
          relation: "同事",
          status: "planned",
          evidence: { quote: "小林" },
        },
      ],
    });
    const result = await store.applyProposal(q.id, {
      identities: { ...mapping(a), b: { person_id: b.id, expected_revision: 1 } },
    });
    const links = await new GraphStore(db.executor).getLinks(a.slug);
    expect(links.some((l) => l.link_type === "crm:relationship:planned:同事")).toBe(true);
    const entry = await store.getEntry(result.entry_ids[0]);
    if (entry.data.kind !== "relationship") throw new Error("wrong fixture");
    await expect(
      store.correctEntry(entry.id, {
        entry: { ...entry.data, object: String(a.id) },
        expected_revision: 1,
        reason: "错误自指",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await store.getEntry(entry.id)).revision).toBe(1);
  });

  it("extracts a proposal using original time without applying or sending unrelated profiles", async () => {
    const r = await capture();
    let messages = "";
    const q = await proposeRecord(store, r.id, () => ({
      chat: async (m) => {
        messages = JSON.stringify(m);
        return JSON.stringify({ people: [{ key: "a", name: "小林" }], entries: [interaction()] });
      },
    }));
    expect(q.origin).toBe("ai");
    expect(q.status).toBe("pending");
    expect(messages).toContain("2026-10-03T19:07:00+08:00");
    expect(messages).toContain("Asia/Shanghai");
    expect(messages).not.toContain("13800001234");
    await expect(
      proposeRecord(store, r.id, () => ({ chat: async () => "not-json" })),
    ).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect((await store.getRecord(r.id)).content).toBe(r.content);
  });
});

describe("temporal validation", () => {
  it("rejects impossible dates, local datetimes without offsets and fabricated precision", () => {
    for (const t of [
      { value: "2026-02-30", precision: "day" },
      { value: "2026-13", precision: "month" },
      { value: "2026-10-03T19:07:00", precision: "second" },
      { value: "2026-10-03", precision: "unknown" },
      { value: "2026-10-03T19:07:32+08:00", precision: "minute" },
    ])
      expect(TimeSchema.safeParse(t).success).toBe(false);
    expect(
      TimeSchema.safeParse({ value: "2026-10-03T19:07:00+08:00", precision: "minute" }).success,
    ).toBe(true);
    expect(
      ProfileSchema.safeParse({
        name: "x",
        addresses: [
          {
            value: "住址",
            valid_from: { value: "2026-11-01", precision: "day" },
            valid_until: { value: "2026-10-01", precision: "day" },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("uses timezone calendar bounds including DST", () => {
    expect(
      timeBounds({ value: "2026-10-02", precision: "day", timezone: "Asia/Shanghai" }),
    ).toEqual(["2026-10-01T16:00:00.000Z", "2026-10-02T16:00:00.000Z"]);
    expect(
      timeBounds({ value: "2026-03-08", precision: "day", timezone: "America/New_York" }),
    ).toEqual(["2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"]);
    expect(timeBounds({ value: null, precision: "unknown" })).toEqual([null, null]);
  });
});

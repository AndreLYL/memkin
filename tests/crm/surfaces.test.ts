import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CrmStore } from "../../src/crm/store.js";
import { createApiApp } from "../../src/server/api.js";
import { createMcpServer } from "../../src/server/mcp.js";
import { ChunkStore } from "../../src/store/chunks.js";
import { Database } from "../../src/store/database.js";
import { EmbeddingService } from "../../src/store/embedding.js";
import { GraphStore } from "../../src/store/graph.js";
import { PageStore } from "../../src/store/pages.js";
import { SearchEngine } from "../../src/store/search.js";
import { TagStore } from "../../src/store/tags.js";
import { TimelineStore } from "../../src/store/timeline.js";

describe("person memory REST and MCP", () => {
  let stores: Parameters<typeof createApiApp>[0];
  beforeAll(async () => {
    const db = await Database.create(undefined, { embeddingDimensions: 768 });
    stores = {
      db,
      pages: new PageStore(db.executor),
      chunks: new ChunkStore(db.executor),
      graph: new GraphStore(db.executor),
      tags: new TagStore(db.executor),
      timeline: new TimelineStore(db.executor),
      search: new SearchEngine(db.executor),
      embedding: new EmbeddingService(db.executor, {
        provider: "openai",
        apiKey: "test-only",
        dimensions: 768,
      }),
    };
  });
  afterAll(async () => {
    await stores.db.close();
  });
  const source = {
    content: "小王的电话是 13800001234，生日是公历六月十二。下个月准备搬家。",
    captured_at: "2026-10-03T19:07:00+08:00",
    timezone: "Asia/Shanghai",
  };
  const post = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("inherits API authentication on every CRM route", async () => {
    const app = createApiApp(stores, { authToken: "test-auth" });
    expect((await app.request("/api/crm/people")).status).toBe(401);
    expect((await app.request("/api/crm/records", post(source))).status).toBe(401);
    expect(
      (await app.request("/api/crm/people", { headers: { authorization: "Bearer test-auth" } }))
        .status,
    ).toBe(200);
  });

  it("saves original source before missing-provider failure and validates errors", async () => {
    const app = createApiApp(stores);
    const captured = await app.request("/api/crm/records", post(source));
    expect(captured.status).toBe(201);
    const record = await captured.json();
    const extraction = await app.request(`/api/crm/records/${record.id}/extract`, post({}));
    expect(extraction.status).toBe(503);
    expect((await extraction.json()).error.code).toBe("UNAVAILABLE");
    expect((await (await app.request(`/api/crm/records/${record.id}`)).json()).content).toBe(
      source.content,
    );
    expect((await app.request("/api/crm/people", post({ profile: { name: "" } }))).status).toBe(
      400,
    );
    expect((await app.request("/api/crm/timeline?from=not-a-time")).status).toBe(400);
    expect((await app.request("/api/crm/people/not-an-id")).status).toBe(400);
    expect((await app.request("/api/crm/people/2147483647")).status).toBe(404);
  });

  it("profile extraction is a separately confirmed patch with an exact quote", async () => {
    const store = new CrmStore(stores.db.executor);
    const person = await store.createPerson({
      profile: { name: "小王", contacts: [{ kind: "email", value: "old@example.test" }] },
    });
    const record = await store.capture(source);
    const data = {
      people: [
        {
          key: "a",
          name: "小王",
          profile_patch: {
            contacts: [{ kind: "phone", value: "13800001234" }],
            birthday: { month: 6, day: 12 },
          },
          evidence: { quote: "小王的电话是 13800001234，生日是公历六月十二" },
        },
      ],
      entries: [
        {
          kind: "fact",
          subject: "a",
          predicate: "搬家",
          value: "准备搬家",
          status: "planned",
          evidence: { quote: "下个月准备搬家" },
        },
      ],
    };
    const q = await store.saveProposal(record.id, data);
    await store.applyProposal(q.id, {
      identities: { a: { person_id: person.id, expected_revision: 1 } },
    });
    expect((await store.getPerson(person.id)).profile.contacts[0].kind).toBe("email");
    const q2 = await store.saveProposal(record.id, data);
    await store.applyProposal(q2.id, {
      identities: { a: { person_id: person.id, expected_revision: 1, apply_profile: true } },
    });
    const updated = await store.getPerson(person.id);
    expect(updated.profile.contacts[0].kind).toBe("phone");
    expect(updated.profile.birthday).toMatchObject({ month: 6, day: 12 });
    expect(updated.profile.addresses).toEqual([]);
    expect(updated.revision).toBe(2);
    expect(await store.history("person", String(person.id))).toHaveLength(2);
  });

  it("supports real SDK MCP initialization, capture, review, apply and recall", async () => {
    const server = createMcpServer(stores);
    const client = new Client({ name: "crm-test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const tools = await client.listTools();
      expect(tools.tools.filter((t) => t.name.startsWith("crm_"))).toHaveLength(12);
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        if (!("content" in result) || result.content[0]?.type !== "text")
          throw new Error("missing result");
        return { result: JSON.parse(result.content[0].text), isError: result.isError };
      };
      const p = (await call("crm_create_person", { profile: { name: "MCP 小王" } })).result;
      const r = (await call("crm_capture_record", { ...source, person_ids: [p.id] })).result;
      const unavailable = await call("crm_create_proposal", { record_id: r.id });
      expect(unavailable.isError).toBe(true);
      expect(unavailable.result.error.code).toBe("UNAVAILABLE");
      const proposal = (
        await call("crm_create_proposal", {
          record_id: r.id,
          data: {
            people: [{ key: "a", name: "MCP 小王" }],
            entries: [
              {
                kind: "fact",
                subject: "a",
                predicate: "近况",
                value: "准备搬家",
                status: "planned",
                evidence: { quote: "下个月准备搬家" },
              },
            ],
          },
        })
      ).result;
      const applied = await call("crm_apply_proposal", {
        proposal_id: proposal.id,
        identities: { a: { person_id: p.id, expected_revision: 1 } },
      });
      expect(applied.isError).not.toBe(true);
      const recalled = await call("crm_timeline", {
        person_id: p.id,
        axis: "captured",
        from: "2026-10-03",
        to: "2026-10-03",
      });
      expect(recalled.result).toHaveLength(1);
      expect(recalled.result[0].data.status).toBe("planned");
      expect(
        (await call("crm_get_record", { record_id: r.id })).result.record.captured_at_input,
      ).toBe(source.captured_at);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("read-only MCP exposes all six CRM reads and none of the write tools", async () => {
    const server = createMcpServer(stores, { readOnly: true });
    const client = new Client({ name: "read-only-test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    await client.connect(a);
    try {
      const names = (await client.listTools()).tools
        .filter((t) => t.name.startsWith("crm_"))
        .map((t) => t.name);
      expect(names.sort()).toEqual([
        "crm_get_person",
        "crm_get_record",
        "crm_history",
        "crm_list_people",
        "crm_list_records",
        "crm_timeline",
      ]);
      await expect(
        client.callTool({ name: "crm_capture_record", arguments: source }),
      ).rejects.toThrow();
    } finally {
      await client.close();
      await server.close();
    }
  });
});

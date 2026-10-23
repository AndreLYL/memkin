import { Hono } from "hono";
import { ZodError } from "zod";
import { type CrmProvider, proposeRecord } from "../crm/extract.js";
import { CrmError, CrmStore } from "../crm/store.js";
import type { SqlExecutor } from "../store/sql-executor.js";

export function createCrmRoutes(db: SqlExecutor, getProvider?: CrmProvider): Hono {
  const app = new Hono();
  const store = new CrmStore(db);
  app.onError((error, c) => {
    if (error instanceof ZodError)
      return c.json({ error: { code: "INVALID_ARGUMENT", message: error.message } }, 400);
    if (error instanceof CrmError)
      return c.json(
        { error: { code: error.code, message: error.message } },
        error.code === "NOT_FOUND"
          ? 404
          : error.code === "CONFLICT"
            ? 409
            : error.code === "UNAVAILABLE"
              ? 503
              : 400,
      );
    if (error instanceof SyntaxError)
      return c.json({ error: { code: "INVALID_ARGUMENT", message: "Invalid JSON body" } }, 400);
    console.error("[crm]", error);
    return c.json({ error: { code: "INTERNAL_ERROR", message: "CRM operation failed" } }, 500);
  });
  app.get("/people", async (c) =>
    c.json(
      await store.listPeople(
        c.req.query("q") ?? "",
        number(c.req.query("limit"), 100),
        number(c.req.query("offset"), 0),
      ),
    ),
  );
  app.post("/people", async (c) => c.json(await store.createPerson(await c.req.json()), 201));
  app.get("/people/:id", async (c) => c.json(await store.getPerson(Number(c.req.param("id")))));
  app.put("/people/:id", async (c) =>
    c.json(await store.updatePerson(Number(c.req.param("id")), await c.req.json())),
  );
  app.get("/records", async (c) =>
    c.json(
      await store.listRecords(
        c.req.query("person_id") ? number(c.req.query("person_id"), 0) : undefined,
        number(c.req.query("limit"), 100),
        number(c.req.query("offset"), 0),
      ),
    ),
  );
  app.post("/records", async (c) => c.json(await store.capture(await c.req.json()), 201));
  app.get("/records/:id", async (c) => c.json(await store.getRecord(c.req.param("id"))));
  app.get("/records/:id/proposals", async (c) =>
    c.json(await store.listProposals(c.req.param("id"))),
  );
  app.post("/records/:id/proposals", async (c) =>
    c.json(await store.saveProposal(c.req.param("id"), await c.req.json()), 201),
  );
  app.post("/records/:id/extract", async (c) =>
    c.json(await proposeRecord(store, c.req.param("id"), getProvider), 201),
  );
  app.post("/proposals/:id/apply", async (c) =>
    c.json(await store.applyProposal(c.req.param("id"), await c.req.json())),
  );
  app.get("/timeline", async (c) => {
    const q = c.req.query();
    return c.json(
      await store.timeline({
        ...q,
        ...(q.person_id ? { person_id: Number(q.person_id) } : {}),
        ...(q.limit ? { limit: Number(q.limit) } : {}),
        ...(q.offset ? { offset: Number(q.offset) } : {}),
      }),
    );
  });
  app.get("/entries/:id", async (c) => c.json(await store.getEntry(c.req.param("id"))));
  app.put("/entries/:id", async (c) =>
    c.json(await store.correctEntry(c.req.param("id"), await c.req.json())),
  );
  app.get("/history/:type/:id", async (c) => {
    const type = c.req.param("type");
    if (type !== "person" && type !== "entry")
      throw new CrmError("INVALID_ARGUMENT", "History type must be person or entry");
    return c.json(await store.history(type, c.req.param("id")));
  });
  return app;
}

function number(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new CrmError("INVALID_ARGUMENT", "Expected a non-negative integer");
  return n;
}

import { describe, it, expect } from "vitest";
import { checkPostgres } from "../../src/setup/doctor.js";

const BASE = process.env.MEMOARK_TEST_PG_URL;
const d = BASE ? describe : describe.skip;
d("checkPostgres", () => {
  it("reports connectivity + pgvector ready", async () => {
    const r = await checkPostgres(BASE!);
    expect(r.connected).toBe(true);
    expect(r.vectorReady).toBe(true); // local PG has pgvector 0.8.2
  });
  it("reports not-connected for a bad url", async () => {
    const r = await checkPostgres("postgres://localhost:1/nope");
    expect(r.connected).toBe(false);
  });
});

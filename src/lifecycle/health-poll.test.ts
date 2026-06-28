import { describe, expect, it } from "vitest";
import { isReady, pollHealth } from "./health-poll.js";

const expected = { instanceId: "n1", port: 3928, bind: "127.0.0.1", engine: "postgres" };
const okBody = {
  instance_id: "n1",
  db_ok: true,
  read_only: false,
  port: 3928,
  bind: "127.0.0.1",
  engine: "postgres",
};

describe("isReady", () => {
  it("all match → ready", () => {
    expect(isReady({ status: 200, body: okBody }, expected)).toBe(true);
  });
  it("nonce mismatch → not ready", () => {
    expect(isReady({ status: 200, body: { ...okBody, instance_id: "OTHER" } }, expected)).toBe(
      false,
    );
  });
  it("503 → not ready", () => {
    expect(isReady({ status: 503, body: {} }, expected)).toBe(false);
  });
  it("db_ok false → not ready", () => {
    expect(isReady({ status: 200, body: { ...okBody, db_ok: false } }, expected)).toBe(false);
  });
  it("read_only true → not ready", () => {
    expect(isReady({ status: 200, body: { ...okBody, read_only: true } }, expected)).toBe(false);
  });
  it("engine mismatch → not ready", () => {
    expect(isReady({ status: 200, body: { ...okBody, engine: "pglite" } }, expected)).toBe(false);
  });
  it("absent port/bind in body → still ready (not enforced when missing)", () => {
    const { port, bind, ...rest } = okBody;
    expect(isReady({ status: 200, body: rest }, expected)).toBe(true);
  });
});

describe("pollHealth", () => {
  it("returns true once health becomes ready", async () => {
    let n = 0;
    const fetchHealth = async () =>
      n++ < 2 ? { status: 503, body: {} } : { status: 200, body: okBody };
    const ok = await pollHealth(fetchHealth, expected, {
      timeoutMs: 10000,
      intervalMs: 1,
      now: (() => {
        let t = 0;
        return () => (t += 1);
      })(),
      sleep: async () => {},
    });
    expect(ok).toBe(true);
  });
  it("returns false on timeout", async () => {
    const fetchHealth = async () => ({ status: 503, body: {} });
    let t = 0;
    const ok = await pollHealth(fetchHealth, expected, {
      timeoutMs: 5,
      intervalMs: 1,
      now: () => (t += 2),
      sleep: async () => {},
    });
    expect(ok).toBe(false);
  });
});

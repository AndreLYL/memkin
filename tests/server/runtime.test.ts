import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ServerHandle, startServer } from "../../src/server/runtime.js";

const mocks = vi.hoisted(() => {
  const close = vi.fn();
  return {
    close,
    serve: vi.fn(() => ({
      address: () => ({ port: 3927 }),
      close,
    })),
  };
});

vi.mock("@hono/node-server", () => ({ serve: mocks.serve }));

describe("startServer", () => {
  const handles: ServerHandle[] = [];
  let originalBun: unknown;

  beforeEach(() => {
    originalBun = (globalThis as { Bun?: unknown }).Bun;
    delete (globalThis as { Bun?: unknown }).Bun;
    mocks.close.mockClear();
    mocks.serve.mockClear();
  });

  afterEach(() => {
    while (handles.length > 0) {
      handles.pop()?.close();
    }
    if (originalBun === undefined) {
      delete (globalThis as { Bun?: unknown }).Bun;
    } else {
      (globalThis as { Bun?: unknown }).Bun = originalBun;
    }
  });

  it("starts a fetch app through the Node adapter and returns a normalized handle", async () => {
    const server = await startServer(
      {
        fetch: () => new Response("ok"),
      },
      { port: 3927, hostname: "127.0.0.1" },
    );
    handles.push(server);

    expect(mocks.serve).toHaveBeenCalled();
    expect(server.hostname).toBe("127.0.0.1");
    expect(server.port).toBe(3927);
    expect(typeof server.close).toBe("function");
  });
});

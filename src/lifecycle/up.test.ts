import { describe, expect, it, vi } from "vitest";
import type { AgentRef, BringUpDeps, WireAgentsDeps } from "./up.js";
import { bringUpDaemon, planUp, wireAgents } from "./up.js";

// ---------------------------------------------------------------------------
// T19 — planUp
// ---------------------------------------------------------------------------
describe("planUp", () => {
  it("throws when any env var is missing", () => {
    expect(() =>
      planUp({
        detectedAgents: [],
        missingEnvVars: ["OPENAI_API_KEY"],
        engine: "pglite",
      }),
    ).toThrowError("OPENAI_API_KEY");
  });

  it("throws with all missing vars in the message", () => {
    expect(() =>
      planUp({
        detectedAgents: [],
        missingEnvVars: ["VAR_A", "VAR_B"],
        engine: "postgres",
      }),
    ).toThrowError(/VAR_A.*VAR_B|VAR_B.*VAR_A/);
  });

  it("pglite: stdio-only agents go to skip; http agents go to wire", () => {
    const agents: AgentRef[] = [
      { id: "a1", supportsHttp: true },
      { id: "a2", supportsHttp: false },
      { id: "a3", supportsHttp: false },
      { id: "a4", supportsHttp: true },
    ];
    const result = planUp({ detectedAgents: agents, missingEnvVars: [], engine: "pglite" });
    expect(result.wire.map((a) => a.id)).toEqual(["a1", "a4"]);
    expect(result.skip.map((a) => a.id)).toEqual(["a2", "a3"]);
    expect(result.warnings.some((w) => w.includes("pglite"))).toBe(true);
  });

  it("pglite: all http agents → skip is empty", () => {
    const agents: AgentRef[] = [
      { id: "b1", supportsHttp: true },
      { id: "b2", supportsHttp: true },
    ];
    const result = planUp({ detectedAgents: agents, missingEnvVars: [], engine: "pglite" });
    expect(result.wire).toHaveLength(2);
    expect(result.skip).toHaveLength(0);
  });

  it("postgres: all agents in wire, skip is empty, no warning", () => {
    const agents: AgentRef[] = [
      { id: "c1", supportsHttp: true },
      { id: "c2", supportsHttp: false },
    ];
    const result = planUp({ detectedAgents: agents, missingEnvVars: [], engine: "postgres" });
    expect(result.wire.map((a) => a.id)).toEqual(["c1", "c2"]);
    expect(result.skip).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T20 — bringUpDaemon
// ---------------------------------------------------------------------------
describe("bringUpDaemon", () => {
  function makeDeps(overrides: Partial<BringUpDeps> = {}): BringUpDeps {
    return {
      priorState: null,
      saveOld: vi.fn().mockResolvedValue({ snapshot: "old" }),
      enable: vi.fn().mockResolvedValue(undefined),
      pollReady: vi.fn().mockResolvedValue(true),
      disable: vi.fn().mockResolvedValue(undefined),
      restoreOld: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("first-install + ready → resolves; disable and restoreOld NOT called", async () => {
    const deps = makeDeps({ priorState: null, pollReady: vi.fn().mockResolvedValue(true) });
    await expect(bringUpDaemon(deps)).resolves.toBeUndefined();
    expect(deps.enable).toHaveBeenCalledOnce();
    expect(deps.disable).not.toHaveBeenCalled();
    expect(deps.restoreOld).not.toHaveBeenCalled();
    expect(deps.saveOld).not.toHaveBeenCalled();
  });

  it("first-install + not ready → rejects; disable called; restoreOld NOT called", async () => {
    const deps = makeDeps({ priorState: null, pollReady: vi.fn().mockResolvedValue(false) });
    await expect(bringUpDaemon(deps)).rejects.toThrow("Daemon failed readiness check");
    expect(deps.disable).toHaveBeenCalledOnce();
    expect(deps.restoreOld).not.toHaveBeenCalled();
    expect(deps.saveOld).not.toHaveBeenCalled();
  });

  it("reconcile + ready → resolves; disable and restoreOld NOT called; saveOld called", async () => {
    const deps = makeDeps({
      priorState: { version: 1 },
      pollReady: vi.fn().mockResolvedValue(true),
    });
    await expect(bringUpDaemon(deps)).resolves.toBeUndefined();
    expect(deps.saveOld).toHaveBeenCalledOnce();
    expect(deps.disable).not.toHaveBeenCalled();
    expect(deps.restoreOld).not.toHaveBeenCalled();
  });

  it("reconcile + not ready → rejects; restoreOld called with snapshot; disable NOT called", async () => {
    const snapshot = { version: 1, plist: "old-content" };
    const saveOld = vi.fn().mockResolvedValue(snapshot);
    const deps = makeDeps({
      priorState: { version: 1 },
      saveOld,
      pollReady: vi.fn().mockResolvedValue(false),
    });
    await expect(bringUpDaemon(deps)).rejects.toThrow("Daemon failed readiness check");
    expect(deps.restoreOld).toHaveBeenCalledOnce();
    expect(deps.restoreOld).toHaveBeenCalledWith(snapshot);
    expect(deps.disable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T21 — wireAgents
// ---------------------------------------------------------------------------
describe("wireAgents", () => {
  type Agent = { id: string };

  function makeWriteAgent(failAtIndex: number | null) {
    let callCount = 0;
    return vi.fn().mockImplementation(async (_agent: Agent) => {
      callCount++;
      if (failAtIndex !== null && callCount === failAtIndex) {
        throw new Error(`write failed at call ${callCount}`);
      }
    });
  }

  function makeDeps(overrides: Partial<WireAgentsDeps<Agent>> = {}): WireAgentsDeps<Agent> {
    return {
      plan: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
      reconcile: false,
      writeAgent: makeWriteAgent(null),
      rollbackToBeforeImage: vi.fn().mockResolvedValue(undefined),
      restoreOldDaemon: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it("all succeed → resolves; neither rollback called", async () => {
    const deps = makeDeps();
    await expect(wireAgents(deps)).resolves.toBeUndefined();
    expect(deps.rollbackToBeforeImage).not.toHaveBeenCalled();
    expect(deps.restoreOldDaemon).not.toHaveBeenCalled();
  });

  it("first-install: 3rd write fails → rejects; rollbackToBeforeImage called; restoreOldDaemon NOT called", async () => {
    const deps = makeDeps({
      reconcile: false,
      writeAgent: makeWriteAgent(3),
    });
    await expect(wireAgents(deps)).rejects.toThrow("write failed at call 3");
    expect(deps.rollbackToBeforeImage).toHaveBeenCalledOnce();
    expect(deps.restoreOldDaemon).not.toHaveBeenCalled();
  });

  it("reconcile: 3rd write fails → rejects; rollbackToBeforeImage called; restoreOldDaemon called", async () => {
    const deps = makeDeps({
      reconcile: true,
      writeAgent: makeWriteAgent(3),
    });
    await expect(wireAgents(deps)).rejects.toThrow("write failed at call 3");
    expect(deps.rollbackToBeforeImage).toHaveBeenCalledOnce();
    expect(deps.restoreOldDaemon).toHaveBeenCalledOnce();
  });
});

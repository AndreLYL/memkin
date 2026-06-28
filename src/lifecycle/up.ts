export interface AgentRef {
  id: string;
  supportsHttp: boolean;
}

export interface PlanUpDeps {
  detectedAgents: AgentRef[];
  missingEnvVars: string[];
  engine: "pglite" | "postgres";
}

export interface UpPlan {
  wire: AgentRef[];
  skip: AgentRef[];
  warnings: string[];
}

export function planUp(deps: PlanUpDeps): UpPlan {
  if (deps.missingEnvVars.length > 0) {
    throw new Error(
      `Cannot start daemon: missing env vars referenced in config: ${deps.missingEnvVars.join(", ")}`,
    );
  }
  const warnings: string[] = [];
  // On pglite, a 2nd stdio process would collide on the single-writer lock → skip stdio-only agents.
  if (deps.engine === "pglite") {
    warnings.push(
      "pglite: concurrent CLI commands and stdio-only agents are unsafe; postgres recommended",
    );
    const wire = deps.detectedAgents.filter((a) => a.supportsHttp);
    const skip = deps.detectedAgents.filter((a) => !a.supportsHttp);
    return { wire, skip, warnings };
  }
  return { wire: deps.detectedAgents, skip: [], warnings };
}

export interface BringUpDeps {
  priorState: unknown | null; // null = first-install; non-null = reconcile
  saveOld: () => Promise<unknown>; // snapshot current plist/unit + daemon.json (reconcile only)
  enable: () => Promise<void>; // write new service file + daemon.json + activate launcher
  pollReady: () => Promise<boolean>; // identity+readiness /health poll
  disable: () => Promise<void>; // teardown: bootout/disable + remove service file + daemon.json
  restoreOld: (saved: unknown) => Promise<void>; // re-write + re-activate the saved old artifacts
}

export async function bringUpDaemon(deps: BringUpDeps): Promise<void> {
  const reconcile = deps.priorState !== null;
  const saved = reconcile ? await deps.saveOld() : null;
  await deps.enable();
  const ready = await deps.pollReady();
  if (ready) return;
  // Not ready → undo
  if (reconcile) {
    await deps.restoreOld(saved);
  } else {
    await deps.disable();
  }
  throw new Error("Daemon failed readiness check; rolled back.");
}

export interface WireAgentsDeps<A = { id: string }> {
  plan: A[];
  reconcile: boolean;
  writeAgent: (agent: A) => Promise<void>; // records Layer-1 + Layer-2 backup then writes (caller's concern)
  rollbackToBeforeImage: () => Promise<void>; // restore this run's agent writes from Layer-2
  restoreOldDaemon: () => Promise<void>; // restore the prior daemon (reconcile only)
}

export async function wireAgents<A>(deps: WireAgentsDeps<A>): Promise<void> {
  try {
    for (const agent of deps.plan) {
      await deps.writeAgent(agent);
    }
  } catch (err) {
    await deps.rollbackToBeforeImage();
    if (deps.reconcile) {
      await deps.restoreOldDaemon();
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

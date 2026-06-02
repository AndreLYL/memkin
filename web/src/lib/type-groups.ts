export const TYPE_GROUPS: Record<string, string[]> = {
  Person: ["person"],
  Project: ["project"],
  Decision: ["decision"],
  Knowledge: ["knowledge", "concept"],
  Task: ["task"],
};

export const TYPE_COLORS: Record<string, string> = {
  person: "var(--color-person)",
  project: "var(--color-project)",
  decision: "var(--color-decision)",
  knowledge: "var(--color-knowledge)",
  concept: "var(--color-knowledge)",
  task: "var(--color-task)",
  session: "var(--color-session)",
};

export const TYPE_BG_CLASSES: Record<string, string> = {
  person: "bg-person/15 text-person",
  project: "bg-project/15 text-project",
  decision: "bg-decision/15 text-decision",
  knowledge: "bg-knowledge/15 text-knowledge",
  concept: "bg-knowledge/15 text-knowledge",
  task: "bg-task/15 text-task",
  session: "bg-session/15 text-session",
};

export function getTypeColor(type: string): string {
  if (type.startsWith("discovery-")) return TYPE_COLORS.knowledge;
  return TYPE_COLORS[type] ?? "var(--color-fg-muted)";
}

export function getTypeBgClass(type: string): string {
  if (type.startsWith("discovery-")) return TYPE_BG_CLASSES.knowledge;
  return TYPE_BG_CLASSES[type] ?? "bg-fg-subtle/15 text-fg-muted";
}

export function getGroupForType(type: string): string {
  if (type.startsWith("discovery-")) return "Knowledge";
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    if (types.includes(type)) return group;
  }
  return "Other";
}

export function expandGroupToTypes(
  group: string,
  allTypes: string[],
): { types?: string[]; exclude_types?: string[] } {
  if (group === "Other") {
    const knownTypes = Object.values(TYPE_GROUPS).flat();
    const discoveryTypes = allTypes.filter((t) => t.startsWith("discovery-"));
    return { exclude_types: [...knownTypes, ...discoveryTypes] };
  }
  const base = TYPE_GROUPS[group] ?? [];
  if (group === "Knowledge") {
    const discoveryTypes = allTypes.filter((t) => t.startsWith("discovery-"));
    return { types: [...base, ...discoveryTypes] };
  }
  return { types: base };
}

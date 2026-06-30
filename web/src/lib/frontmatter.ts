export function parseFrontmatter(compiledTruth: string): Record<string, string> {
  const fm: Record<string, string> = {};
  const match = compiledTruth?.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return fm;
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return fm;
}

export function stripFrontmatter(compiledTruth: string): string {
  return compiledTruth?.replace(/^---\n[\s\S]*?\n---\n*/, "") ?? "";
}

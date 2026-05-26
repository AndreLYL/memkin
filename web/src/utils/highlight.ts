export interface SnippetFragment {
  text: string;
  highlighted: boolean;
}

export function parseSnippet(snippet: string): SnippetFragment[] {
  const regex = /\*\*(.*?)\*\*/g;
  const fragments: SnippetFragment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(snippet)) !== null) {
    if (match.index > lastIndex) {
      fragments.push({ text: snippet.slice(lastIndex, match.index), highlighted: false });
    }
    fragments.push({ text: match[1], highlighted: true });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < snippet.length || fragments.length === 0) {
    fragments.push({ text: snippet.slice(lastIndex), highlighted: false });
  }

  return fragments;
}

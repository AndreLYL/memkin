interface CardPage {
  frontmatter: Record<string, unknown>;
}

export interface CardSummary {
  total: number;
  full: number;
  pointer: number;
  failed: number;
}

export function summarizeCards(pages: CardPage[]): CardSummary {
  let full = 0;
  let pointer = 0;
  let failed = 0;
  for (const p of pages) {
    const fm = p.frontmatter;
    if (fm.extract_level === "full") full++;
    else pointer++;
    if (fm.extract_error) failed++;
  }
  return { total: pages.length, full, pointer, failed };
}

export function failedCards(pages: CardPage[]): Array<{ doc_token: string; error: string }> {
  return pages
    .filter((p) => p.frontmatter.extract_error)
    .map((p) => ({
      doc_token: String(p.frontmatter.doc_token ?? "?"),
      error: String(p.frontmatter.extract_error),
    }));
}

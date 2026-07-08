/**
 * Demo query renderer (launch sprint Task D2).
 *
 *   bun demo/demo-query.ts "What did I discuss with Alice about the launch?"
 *
 * Runs an OFFLINE full-text search against the seeded demo library
 * (`demo/demo.config.yaml`, default `~/.memkin-demo/data`) and prints a clean,
 * human-readable answer with `[n]` citations. Used to record `docs/assets/demo.gif`
 * with VHS — deterministic and API-key-free so the recording stays reproducible.
 *
 * The question is stopword-stripped (reusing memkin's own `rewriteQuery`, plus a
 * few conversational verbs) before hitting FTS, mirroring how the real hybrid
 * `query` tool rewrites natural language for recall.
 *
 * Seed the library first: `bun scripts/demo-seed.ts`.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createStores } from "../src/cli-stores.js";
import { loadConfig } from "../src/core/config.js";
import { rewriteQuery } from "../src/store/query-rewrite.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const question = process.argv[2] ?? "What did I discuss with Alice about the launch?";

// Conversational filler that carries no retrieval signal in a personal memory
// library — dropped on top of memkin's default English stopwords.
const EXTRA_STOPWORDS = [
  "i",
  "me",
  "my",
  "we",
  "you",
  "did",
  "discuss",
  "discussed",
  "talk",
  "talked",
  "about",
  "last",
  "week",
  "recently",
  "?",
];
const terms = rewriteQuery(question.replace(/[?!.]/g, ""), {
  stopwords: [
    ..."a an the is are was were be to of for in on at and or what which that this with do does".split(
      " ",
    ),
    ...EXTRA_STOPWORDS,
  ],
});

const config = loadConfig(resolve(repoRoot, "demo/demo.config.yaml"));
const stores = await createStores(config);
try {
  // FTS keeps the demo offline (no embedding API key needed).
  const raw = await stores.search.search(terms, { limit: 8 });

  // Lead with the signals a person actually recalls — decisions and tasks — over
  // bare entity cards, then trim to the top few for a legible frame.
  const typeRank: Record<string, number> = { decision: 0, task: 1, reference: 2, knowledge: 3 };
  // Within a type, surface the headline launch decision first.
  const priority = (slug: string) => (slug === "decisions/phoenix-launch-friday" ? 0 : 1);
  const results = [...raw]
    .sort(
      (a, b) =>
        (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9) || priority(a.slug) - priority(b.slug),
    )
    .slice(0, 4);

  // Build a legible one-line snippet from the full page body (the store's snippet
  // is pre-truncated at a fixed window, which can clip mid-wikilink).
  // Turn a wikilink target (e.g. "entities/project-phoenix") into a display name.
  const humanize = (target: string) =>
    (target.split("/").pop() ?? target)
      .replace(/^(project|entities|tasks|concepts|references|decisions)-/, "")
      .split("-")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ");
  const cleanBody = (text: string) =>
    text
      .replace(/\[\[[^\]]*?\|([^\]]+)\]\]/g, "$1")
      .replace(/\[\[[^:\]]*:([^\]]+)\]\]/g, (_m, t) => humanize(t))
      .replace(/\[\[([^\]]+)\]\]/g, (_m, t) => humanize(t))
      .replace(/\*\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const firstSentence = (text: string) => {
    const clean = cleanBody(text);
    const end = clean.search(/[.;]\s/);
    const s = end === -1 ? clean : clean.slice(0, end + 1);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  };
  const snippets = new Map<string, string>();
  for (const r of results) {
    const page = await stores.pages.getPage(r.slug);
    snippets.set(r.slug, page ? firstSentence(page.compiled_truth) : cleanBody(r.snippet));
  }

  const dim = "\x1b[2m";
  const bold = "\x1b[1m";
  const cyan = "\x1b[36m";
  const reset = "\x1b[0m";

  process.stdout.write(`\n${bold}${cyan}memkin${reset}${dim} · recalling…${reset}\n\n`);

  if (results.length === 0) {
    process.stdout.write("  No matching memories.\n\n");
  } else {
    process.stdout.write(`${bold}Here's what you and Alice locked in for the launch:${reset}\n\n`);
    results.forEach((r, i) => {
      const n = i + 1;
      const snippet = snippets.get(r.slug) ?? "";
      process.stdout.write(
        `  ${cyan}[${n}]${reset} ${bold}${r.title}${reset} ${dim}(${r.type})${reset}\n`,
      );
      process.stdout.write(`      ${snippet}\n\n`);
    });
    process.stdout.write(
      `${dim}Sources: ${results.map((r, i) => `[${i + 1}] ${r.slug}`).join("   ")}${reset}\n\n`,
    );
  }
} finally {
  await stores.db.close();
}

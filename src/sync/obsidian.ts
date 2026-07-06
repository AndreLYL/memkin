/**
 * Obsidian vault bidirectional sync.
 *
 * Implements `memkin export --vault <path>` and `memkin import --vault <path>`.
 * See spec: docs/specs/memkin-2026-06-04-obsidian-sync.md (v7).
 */

import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import type { ChunkStore } from "../store/chunks.js";
import type { Database } from "../store/database.js";
import type { GraphStore, LinkRow } from "../store/graph.js";
import type { Page, PageStore } from "../store/pages.js";
import type { TagStore } from "../store/tags.js";
import type { TimelineEntry, TimelineStore } from "../store/timeline.js";

// ============================================================================
// Constants
// ============================================================================

const RELATED_MARKER = "<!-- memkin:related -->";
const TIMELINE_MARKER = "<!-- memkin:timeline -->";

/** Unicode-safe slug regex (H3). */
const SLUG_REGEX = /^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u;

/** Windows reserved names (L6) — rejected on all platforms for portability. */
const WINDOWS_RESERVED = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const MAX_SLUG_LENGTH = 200;

/** Wikilink pattern: matches [[slug]] or [[slug|display]] with Unicode support. */
const WIKILINK_REGEX = /\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/gu;

// ============================================================================
// Section 1: serializePage (Spec §4.4)
// ============================================================================

/**
 * Serialize a Page into Obsidian-compatible markdown.
 *
 * Fixes applied:
 *   H1: explicit fields written AFTER `...page.frontmatter` so they cannot be
 *       clobbered by user-supplied frontmatter that happens to share a key.
 *   M1: `updated_at` is NOT written to frontmatter — it would change every export
 *       even when content is identical, defeating incremental sync.
 *   N3: rebuild `## Aliases` body section from `frontmatter.aliases` each time
 *       (frontmatter is the single source of truth; the body section is derived).
 */
export function serializePage(
  page: Page,
  tags: string[],
  links: LinkRow[],
  timeline: TimelineEntry[],
  userEdited: boolean,
): string {
  const fm: Record<string, unknown> = {
    // 1. spread page.frontmatter FIRST (low precedence — H1)
    ...page.frontmatter,
    // 2. explicit fields LAST (high precedence — H1)
    title: page.title,
    type: page.type,
    slug: page.slug,
    tags,
    links: links.map((l) => ({ target: l.to_slug, type: l.link_type })),
    content_hash: page.content_hash,
    user_edited: userEdited,
    // NOTE: updated_at intentionally omitted (M1)
  };

  // N3: rebuild Aliases section from frontmatter, not from body
  const aliases = (page.frontmatter.aliases as string[] | undefined) ?? [];
  const compiledWithoutAliases = stripAliasesSection(page.compiled_truth);

  const bodyParts: string[] = [];

  if (aliases.length > 0) {
    bodyParts.push("## Aliases", "");
    for (const alias of aliases) {
      bodyParts.push(`- ${alias}`);
    }
    bodyParts.push("");
  }

  bodyParts.push(compiledWithoutAliases.trim());

  if (links.length > 0) {
    bodyParts.push("", "<!-- memkin:related -->", "");
    for (const link of links) {
      bodyParts.push(`- [[${link.to_slug}]]`);
    }
  }

  if (timeline.length > 0) {
    bodyParts.push("", "<!-- memkin:timeline -->", "");
    bodyParts.push("> ⚠️ Timeline 为只读派生数据，编辑此处不会同步回 DB", "");
    for (const entry of timeline) {
      bodyParts.push(`- **${entry.date}**: ${entry.summary}`);
    }
  }

  const body = bodyParts.join("\n");
  const fmYaml = yamlStringify(fm).trimEnd();

  return `---\n${fmYaml}\n---\n\n${body}\n`;
}

/**
 * Strip `## Aliases\n\n- ...` section if it appears at the start of body.
 *
 * Only matches at body start so that mid-body Aliases-like headings stay intact.
 */
export function stripAliasesSection(body: string): string {
  const pattern = /^##\s+Aliases\s*\n+(?:- .+\n?)+\n*/;
  return body.replace(pattern, "").trimStart();
}

// ============================================================================
// Section 2: parseVaultFile + helpers (Spec §6.5)
// ============================================================================

export interface SplitBodyResult {
  mainBody: string;
  related: string;
  timeline: string;
  orderError: boolean;
}

/**
 * Split body into three sections by HTML comment markers.
 *
 * Fixes:
 *   M3: detect marker order reversal (timeline before related) and signal error.
 */
export function splitBody(body: string): SplitBodyResult {
  const rIdx = body.indexOf(RELATED_MARKER);
  const tIdx = body.indexOf(TIMELINE_MARKER);

  // M3: timeline marker must come after related marker if both exist
  if (rIdx >= 0 && tIdx >= 0 && tIdx < rIdx) {
    return { mainBody: "", related: "", timeline: "", orderError: true };
  }

  let main = body;
  let related = "";
  let timeline = "";

  // Split timeline first (later marker), then related
  if (tIdx >= 0) {
    timeline = main.slice(tIdx + TIMELINE_MARKER.length).trim();
    main = main.slice(0, tIdx);
  }
  if (rIdx >= 0) {
    related = main.slice(rIdx + RELATED_MARKER.length).trim();
    main = main.slice(0, rIdx);
  }

  return { mainBody: main.trim(), related, timeline, orderError: false };
}

/** Validate slug: Unicode-safe + Windows reserved + length (H3 + L6). */
export function isValidSlug(slug: string): boolean {
  if (!slug || slug.length === 0) return false;
  if (slug.length > MAX_SLUG_LENGTH) return false;
  if (!SLUG_REGEX.test(slug)) return false;
  for (const segment of slug.split("/")) {
    if (WINDOWS_RESERVED.has(segment.toLowerCase())) return false;
  }
  return true;
}

/** Convert a file path (relative to vault root) to slug. */
export function slugifyPath(relativePath: string): string {
  return relativePath.replace(/^\.\//, "").replace(/^\//, "").replace(/\.md$/i, "");
}

/** Extract all wikilink targets from text, stripping display suffix. */
export function extractWikilinks(text: string): string[] {
  const results: string[] = [];
  const re = new RegExp(WIKILINK_REGEX.source, WIKILINK_REGEX.flags);
  for (const match of text.matchAll(re)) {
    results.push(match[1].trim());
  }
  return results;
}

interface ParsedFrontmatter {
  fm: Record<string, unknown>;
  body: string;
}

function parseFrontmatterAndBody(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { fm: {}, body: content };
  }
  const fm = (yamlParse(match[1]) ?? {}) as Record<string, unknown>;
  return { fm, body: match[2] };
}

export interface ParseVaultFileResult {
  slug: string;
  cleanMarkdown: string;
  tags: string[];
  links: string[];
}

/**
 * Parse a vault markdown file into the pieces needed for putPage / addTag / addLink.
 *
 * Fixes:
 *   H2-incomplete: filter links by type — only obsidian and bare strings are
 *                  taken as user-editable; pipeline-managed types (works_on,
 *                  collaborates, etc.) are ignored here so they cannot be
 *                  duplicated as obsidian-type edges on round-trip.
 *   H4: inject user_edited=true into cleanMarkdown so putPage persists the lock.
 *   M3: throw if body marker order is reversed.
 *   M7: timeline section is NOT parsed (export-only).
 *   L4: body `## Aliases` section is not interpreted — only frontmatter is.
 */
export function parseVaultFile(content: string, relativePath: string): ParseVaultFileResult {
  const { fm, body } = parseFrontmatterAndBody(content);

  const slugRaw = (fm.slug as string | undefined) ?? slugifyPath(relativePath);
  if (!isValidSlug(slugRaw)) {
    throw new Error(`invalid slug: ${slugRaw}`);
  }
  const slug = slugRaw;

  const split = splitBody(body);
  if (split.orderError) {
    throw new Error("marker order incorrect: timeline appears before related");
  }

  // H2-incomplete: filter frontmatter links to obsidian-type only
  const rawFmLinks = Array.isArray(fm.links) ? (fm.links as unknown[]) : [];
  const fmLinks: string[] = [];
  for (const item of rawFmLinks) {
    if (typeof item === "string") {
      fmLinks.push(item);
    } else if (item && typeof item === "object") {
      const obj = item as { target?: unknown; type?: unknown };
      if (typeof obj.target === "string") {
        const type = obj.type;
        if (type === undefined || type === null || type === "obsidian") {
          fmLinks.push(obj.target);
        }
      }
    }
  }

  // Wikilinks from main body (always treated as obsidian)
  const bodyLinks = extractWikilinks(split.mainBody);
  const links = Array.from(new Set([...fmLinks, ...bodyLinks]));

  const tags = Array.isArray(fm.tags) ? (fm.tags as string[]) : [];

  // Build clean frontmatter for putPage (strip sync-layer metadata)
  const cleanFm: Record<string, unknown> = { ...fm };
  delete cleanFm.slug;
  delete cleanFm.tags;
  delete cleanFm.links;
  delete cleanFm.content_hash;
  delete cleanFm.user_edited;
  // H4: stamp user_edited=true
  cleanFm.user_edited = true;

  const cleanFmYaml = yamlStringify(cleanFm).trimEnd();
  // M7: drop timeline section from main body; keep mainBody only
  const cleanMarkdown = `---\n${cleanFmYaml}\n---\n\n${split.mainBody}\n`;

  return { slug, cleanMarkdown, tags, links };
}

// ============================================================================
// Section 3: Manifest I/O (Spec §4.7 + §7.8)
// ============================================================================

const MANIFEST_FILENAME = ".memkin-sync.json";
const MANIFEST_VERSION = 2;

export interface ManifestPageEntry {
  file_hash: string;
  db_content_hash_at_last_sync: string;
  last_synced_at: string;
  last_synced_op: "export" | "import";
  user_edited: boolean;
}

export interface SyncManifest {
  version: number;
  last_sync_at: string;
  last_sync_op: "export" | "import";
  pages: Record<string, ManifestPageEntry>;
}

/** Load the sync manifest from a vault. Returns null if missing or invalid. */
export async function loadManifest(vaultPath: string): Promise<SyncManifest | null> {
  const path = join(vaultPath, MANIFEST_FILENAME);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<SyncManifest>;
    if (parsed.version !== MANIFEST_VERSION) return null;
    if (!parsed.pages || typeof parsed.pages !== "object") return null;
    return parsed as SyncManifest;
  } catch {
    // Missing, unreadable, or malformed — treat as no manifest
    return null;
  }
}

/**
 * Atomically write the sync manifest (M8 + N2).
 *
 * Procedure:
 *   1. open(tmpPath, "w") → write JSON → handle.sync() → handle.close()
 *   2. rename(tmpPath, targetPath) — POSIX atomic
 *   3. On error: close handle if open, unlink tmp
 *
 * Note: Node `fs.fsync()` takes a file descriptor, not a path. We use
 * `FileHandle.sync()` which is the FileHandle API's wrapper around fsync(fd).
 */
export async function saveManifest(vaultPath: string, manifest: SyncManifest): Promise<void> {
  const targetPath = join(vaultPath, MANIFEST_FILENAME);
  const tmpPath = `${targetPath}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(tmpPath, "w");
    await handle.writeFile(JSON.stringify(manifest, null, 2), "utf-8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(tmpPath, targetPath);
  } catch (e) {
    if (handle) await handle.close().catch(() => {});
    await unlink(tmpPath).catch(() => {});
    throw e;
  }
}

// ============================================================================
// Section 4: Sync stores + options + result types
// ============================================================================

export interface SyncStores {
  db: Database;
  pages: PageStore;
  graph: GraphStore;
  tags: TagStore;
  timeline: TimelineStore;
  chunks: ChunkStore;
}

export interface ExportOpts {
  force?: boolean;
  dryRun?: boolean;
}

export interface ExportResult {
  written: number;
  skipped: number;
  errors: Array<{ slug: string; reason: string }>;
}

export interface ImportOpts {
  force?: boolean;
  dryRun?: boolean;
  strictConflict?: boolean;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ file: string; reason: string }>;
  warnings: Array<{ slug: string; reason: string }>;
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================================
// Section 5: exportToVault (Spec §5)
// ============================================================================

export async function exportToVault(
  stores: SyncStores,
  vaultPath: string,
  opts: ExportOpts = {},
): Promise<ExportResult> {
  const result: ExportResult = { written: 0, skipped: 0, errors: [] };

  // 1. Ensure vault directory exists
  await mkdir(vaultPath, { recursive: true });

  // 2. Load old manifest
  const oldManifest = await loadManifest(vaultPath);

  // 3. List all pages
  const pages = await stores.pages.listPages({ limit: 100000 });

  // 4. M6: batch pre-query tags / links / timeline
  const [tagsBySlug, linksBySlug, timelineBySlug] = await Promise.all([
    stores.tags.getAllTagsGrouped(),
    stores.graph.getAllLinksGrouped(),
    stores.timeline.getAllTimelineGrouped(),
  ]);

  // 5. Build new manifest as we go
  const newManifest: SyncManifest = {
    version: 2,
    last_sync_at: nowIso(),
    last_sync_op: "export",
    pages: {},
  };

  // 6. Per-page serialization
  for (const page of pages) {
    try {
      const tags = tagsBySlug.get(page.slug) ?? [];
      const links = linksBySlug.get(page.slug) ?? [];
      const timeline = timelineBySlug.get(page.slug) ?? [];
      const userEdited = oldManifest?.pages[page.slug]?.user_edited ?? false;

      const content = serializePage(page, tags, links, timeline, userEdited);
      const fileHash = sha256(content);

      const previousFileHash = oldManifest?.pages[page.slug]?.file_hash;
      const unchanged = !opts.force && previousFileHash === fileHash;

      if (!unchanged && !opts.dryRun) {
        const filePath = join(vaultPath, `${page.slug}.md`);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content, "utf-8");
      }

      newManifest.pages[page.slug] = {
        file_hash: fileHash,
        db_content_hash_at_last_sync: page.content_hash,
        last_synced_at: newManifest.last_sync_at,
        last_synced_op: "export",
        user_edited: userEdited,
      };

      if (unchanged) {
        result.skipped += 1;
      } else {
        result.written += 1;
      }
    } catch (e) {
      result.errors.push({
        slug: page.slug,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 7. Persist manifest
  if (!opts.dryRun) {
    await saveManifest(vaultPath, newManifest);
  }

  return result;
}

// ============================================================================
// Section 6: importFromVault (Spec §6)
// ============================================================================

/**
 * Recursively scan markdown files in vault. Defensive against symlinks (L8).
 */
async function scanMarkdownFiles(
  dir: string,
  vaultRoot: string,
  results: string[] = [],
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    // L8: refuse to follow symlinks
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) continue;

    // Defensive: stay within vault boundary
    const resolved = resolve(fullPath);
    if (!resolved.startsWith(resolve(vaultRoot) + sep) && resolved !== resolve(vaultRoot)) {
      continue;
    }

    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      await scanMarkdownFiles(fullPath, vaultRoot, results);
    } else if (entry.isFile()) {
      if (!entry.name.endsWith(".md")) continue;
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Read vault file content, returning null when the file is an iCloud
 * placeholder or empty (L7 + N1).
 */
async function readVaultFile(filePath: string): Promise<string | null> {
  // L7: check for iCloud placeholder sibling .filename.icloud
  const dir = dirname(filePath);
  const base = filePath.slice(dir.length + 1);
  const placeholderPath = join(dir, `.${base}.icloud`);
  try {
    await access(placeholderPath);
    return null;
  } catch {
    // No placeholder — proceed
  }

  const content = await readFile(filePath, "utf-8");
  // N1: only flag genuinely empty content (the v4 regex /^[ -]+/ was nonsense)
  if (content.length === 0 || content.trim().length === 0) {
    return null;
  }
  return content;
}

export async function importFromVault(
  stores: SyncStores,
  vaultPath: string,
  opts: ImportOpts = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: [],
    warnings: [],
  };

  // 1. Verify vault exists
  await access(vaultPath);

  // 2. Load existing manifest (may be null on first import)
  const manifest =
    (await loadManifest(vaultPath)) ??
    ({
      version: 2,
      last_sync_at: nowIso(),
      last_sync_op: "import",
      pages: {},
    } as SyncManifest);

  // 3. Scan vault for markdown files
  const files = await scanMarkdownFiles(vaultPath, vaultPath);

  for (const filePath of files) {
    const relPath = relative(vaultPath, filePath);
    try {
      const content = await readVaultFile(filePath);
      if (content === null) {
        result.warnings.push({
          slug: relPath,
          reason: "iCloud placeholder or empty file — skipping",
        });
        result.skipped += 1;
        continue;
      }

      const fileHash = sha256(content);

      // 4. Parse to extract slug (needed for hash comparison)
      const parsed = parseVaultFile(content, relPath);
      const slug = parsed.slug;

      const previousFileHash = manifest.pages[slug]?.file_hash;
      if (!opts.force && previousFileHash === fileHash) {
        result.skipped += 1;
        continue;
      }

      // 5. H5: detect DB-side changes between syncs
      const existingPage = await stores.pages.getPage(slug);
      const recordedDbHash = manifest.pages[slug]?.db_content_hash_at_last_sync;
      if (
        !opts.force &&
        existingPage &&
        recordedDbHash &&
        existingPage.content_hash !== recordedDbHash
      ) {
        result.warnings.push({
          slug,
          reason: "DB content changed since last sync — your vault edits will overwrite DB changes",
        });
        if (opts.strictConflict) {
          result.skipped += 1;
          continue;
        }
      }

      if (opts.dryRun) {
        result.imported += 1;
        continue;
      }

      // 6. Per-file write sequence (M2 deferred — see Spec §7.9 note)
      //
      // NOTE: We do NOT wrap in pg.transaction() — PGlite's transaction uses
      // a mutex on the single connection, and store methods using `this.pg.query`
      // (instead of tx.query) would deadlock waiting for the mutex to release.
      // Refactoring all store methods to accept tx is out of scope.
      //
      // Atomicity guarantee: NONE. We rely on idempotent upserts:
      //   - putPage: INSERT ... ON CONFLICT UPDATE (idempotent)
      //   - addTag: INSERT ... ON CONFLICT DO NOTHING (idempotent)
      //   - addLink: INSERT ... ON CONFLICT UPDATE (idempotent)
      //   - rechunk: DELETE + INSERT (eventual consistency; retry-safe)
      //
      // If the process crashes mid-write, the next `memkin import` run will
      // re-process the file (file_hash will still differ) and reach a
      // consistent state. Worst case: chunks briefly out of date.
      // autoWikilink:false — Obsidian sync owns [[...]] semantics (creates "obsidian"-typed
      // links below); disable Spec 10 generic auto-wiring so it doesn't shadow them with "mentions".
      const newPage = await stores.pages.putPage(slug, parsed.cleanMarkdown, {
        autoWikilink: false,
      });
      for (const tag of parsed.tags) {
        await stores.tags.addTag(slug, tag);
      }
      // H2-incomplete: only add obsidian-typed links; do not touch
      // pipeline-typed links (works_on, collaborates, mentions, etc.)
      const existingLinks = await stores.graph.getLinks(slug);
      const existingObsidian = new Set(
        existingLinks.filter((l) => l.link_type === "obsidian").map((l) => l.to_slug),
      );
      for (const target of parsed.links) {
        if (existingObsidian.has(target)) continue;
        try {
          await stores.graph.addLink(slug, target, "obsidian", "from obsidian vault");
        } catch (linkErr) {
          // Target may not exist — warn, do not fail
          result.warnings.push({
            slug,
            reason: `addLink ${slug} → ${target}: ${linkErr instanceof Error ? linkErr.message : String(linkErr)}`,
          });
        }
      }
      // M7: NOT processing timeline (export-only)
      await stores.chunks.rechunk(newPage.id, newPage.compiled_truth);

      manifest.pages[slug] = {
        file_hash: fileHash,
        db_content_hash_at_last_sync: newPage.content_hash,
        last_synced_at: nowIso(),
        last_synced_op: "import",
        user_edited: true,
      };
      result.imported += 1;
    } catch (e) {
      result.errors.push({
        file: relPath,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 7. Persist manifest
  if (!opts.dryRun) {
    manifest.last_sync_at = nowIso();
    manifest.last_sync_op = "import";
    await saveManifest(vaultPath, manifest);
  }

  return result;
}

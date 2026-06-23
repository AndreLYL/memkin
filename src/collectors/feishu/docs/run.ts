import type { CursorStore } from "../../../core/cursors.js";
import type { LLMProvider } from "../../../extractors/providers/types.js";
import type { ChunkStore } from "../../../store/chunks.js";
import type { PageStore } from "../../../store/pages.js";
import type { IFeishuHttpClient } from "../http-client.js";
import { type FeishuBlock, feishuBlocksToRawText } from "./blocks.js";
import type { ResolvedDocsConfig } from "./config.js";
import { decide, decideAfterBodyCheck } from "./decision.js";
import { FullCardBuilder } from "./full-builder.js";
import { computeSourceBodyHash } from "./hash.js";
import { buildPointerCard } from "./pointer-builder.js";
import { type ActionItemDeps, loadExistingCard, writeCard } from "./store-writer.js";
import type { DocCandidate, DocCard, DocDecisionConfig, FullCard } from "./types.js";
import { batchSizeForRun, UpgradeQueue } from "./upgrade-queue.js";
import { iterateCandidates } from "./walkers.js";

const CURSOR_KEY = "feishu.docs";

export interface DocSourceStats {
  candidates_scanned: number;
  pointer_saved: number;
  full_card_generated: number;
  full_card_refreshed: number;
  skipped: number;
  upgrade_queue_size: number;
  llm_failed: number;
}

interface DocsCheckpoint {
  upgrade_queue?: { pending: string[]; last_upgrade_at: number };
  run_count?: number;
}

export interface RunDocSourceDeps {
  client: IFeishuHttpClient;
  stores: { pages: PageStore; chunks: ChunkStore };
  provider: LLMProvider;
  config: ResolvedDocsConfig;
  cursor: Pick<CursorStore, "getJSON" | "setJSON" | "commit">;
  selfOpenId: string;
  nowMs: number;
  nowIso: () => string;
  /**
   * Identity/graph deps for persisting action_items as task signals. When
   * provided, FULL cards built this run also write their action_items as
   * `tasks/doc-*` pages (Spec 9 §3.3). Omitted for runs that only need cards.
   */
  actionItemDeps?: ActionItemDeps;
}

export async function runDocSource(deps: RunDocSourceDeps): Promise<DocSourceStats> {
  const { client, stores, provider, config, cursor, selfOpenId, nowMs, nowIso, actionItemDeps } =
    deps;
  const stats: DocSourceStats = {
    candidates_scanned: 0,
    pointer_saved: 0,
    full_card_generated: 0,
    full_card_refreshed: 0,
    skipped: 0,
    upgrade_queue_size: 0,
    llm_failed: 0,
  };

  const checkpoint = cursor.getJSON<DocsCheckpoint>(CURSOR_KEY) ?? {};
  const queue = new UpgradeQueue(
    checkpoint.upgrade_queue?.pending ?? [],
    config.upgrade_queue.max_pending,
  );
  const runCount = checkpoint.run_count ?? 0;

  const decisionConfig: DocDecisionConfig = {
    self_edit: config.triggers.self_edit,
    recent_window_days: config.triggers.recent_window_days,
    important_folders: config.triggers.important_folders,
    important_wiki_spaces: config.triggers.important_wiki_spaces,
  };

  // Candidates enqueued this run, kept in memory so phase 2 can upgrade them
  // directly without round-tripping through the store.
  const enqueuedCandidates = new Map<string, DocCandidate>();

  try {
    // Phase 1: scan + decide
    for await (const candidate of iterateCandidates(client, config)) {
      stats.candidates_scanned++;
      try {
        const existing = await loadExistingCard(stores, candidate.doc_token);
        const decision = decide(candidate, existing, decisionConfig, selfOpenId, nowMs);

        // Resolve the effective terminal action. `needs_body_check` fetches the
        // body and folds into either `metadata_refresh` (refresh the existing
        // full card's metadata) or `queue_for_upgrade` (T5 re-summarize).
        let action: "skip_save" | "save_pointer" | "queue_for_upgrade" | "metadata_refresh";
        if (decision.action === "needs_body_check") {
          const rawText = await fetchRawText(client, candidate.doc_token);
          const newHash = computeSourceBodyHash(rawText);
          const existingHash = existing?.extract_level === "full" ? existing.source_body_hash : "";
          action = decideAfterBodyCheck(newHash, existingHash).action;
        } else {
          action = decision.action;
        }

        if (action === "skip_save") {
          stats.skipped++;
        } else if (action === "metadata_refresh") {
          // existing is a FullCard here (only needs_body_check reaches this); refresh
          // the cheap metadata, KEEP the LLM summary, do NOT call the LLM.
          await writeCard(
            stores,
            {
              ...(existing as FullCard),
              title: candidate.title,
              url: candidate.url,
              modified_at: candidate.modified_at,
              last_editor_id: candidate.last_editor_id,
              parent_path: candidate.parent_path,
              source: candidate.source,
              extracted_at: nowIso(),
            },
            actionItemDeps,
          );
          stats.full_card_refreshed++;
        } else if (action === "save_pointer") {
          await writeCard(stores, buildPointerCard(candidate, nowIso()));
          stats.pointer_saved++;
        } else if (action === "queue_for_upgrade") {
          // Pointer placeholder lands immediately; the full card overwrites it in
          // phase 2, so the placeholder is not counted as a saved pointer.
          if (!existing) {
            await writeCard(stores, buildPointerCard(candidate, nowIso()));
          }
          if (queue.enqueue(candidate.doc_token)) {
            enqueuedCandidates.set(candidate.doc_token, candidate);
          }
        }
      } catch (err) {
        // One bad doc (paginate failure, fetchRawText timeout, write error) must
        // not abort the whole run and lose checkpoint progress. Skip and continue.
        console.error(`feishu.docs: failed to process candidate ${candidate.doc_token}:`, err);
        stats.skipped++;
      }
    }

    // Phase 2: drain the queue
    const k = batchSizeForRun(runCount, config.upgrade_queue);
    const builder = new FullCardBuilder(client, provider, config.llm.model ?? "unknown", nowIso);
    const batch = queue.shift(k);
    for (const docToken of batch) {
      try {
        // Prefer the in-memory candidate from this run; fall back to the stored
        // pointer card for tokens carried over from a previous run's checkpoint.
        const candidate: DocCandidate | null =
          enqueuedCandidates.get(docToken) ?? (await rebuildCandidate(stores, docToken));
        if (!candidate) continue;
        const card = await builder.build(candidate);
        await writeCard(stores, card, actionItemDeps);
        if (card.extract_level === "full") stats.full_card_generated++;
        else stats.llm_failed++;
      } catch (err) {
        // The builder degrades internally, but fetchRawText/writeCard can still
        // throw. Skip this token and keep draining the rest of the batch.
        console.error(`feishu.docs: failed to upgrade ${docToken}:`, err);
        stats.skipped++;
      }
    }
  } finally {
    // Always persist the checkpoint so a mid-run throw does not lose the
    // upgrade-queue pending list or run_count progress.
    stats.upgrade_queue_size = queue.size();
    cursor.setJSON(CURSOR_KEY, {
      upgrade_queue: { pending: queue.pending(), last_upgrade_at: nowMs },
      run_count: runCount + 1,
    } satisfies DocsCheckpoint);
    cursor.commit();
  }

  return stats;
}

async function fetchRawText(client: IFeishuHttpClient, docToken: string): Promise<string> {
  const blocks: FeishuBlock[] = [];
  for await (const page of client.paginate<FeishuBlock>(
    `/open-apis/docx/v1/documents/${docToken}/blocks`,
  )) {
    blocks.push(...page.items);
  }
  return feishuBlocksToRawText(blocks);
}

/** Reconstruct a candidate from the stored pointer card so phase 2 can upgrade it. */
async function rebuildCandidate(
  stores: { pages: PageStore },
  docToken: string,
): Promise<DocCard | null> {
  // The builder only reads DocCandidate fields, so either card kind works here.
  return loadExistingCard(stores, docToken);
}

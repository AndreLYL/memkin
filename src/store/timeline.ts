import type { PGlite } from "@electric-sql/pglite";
import type { SourceRef } from "../core/types.js";

export interface TimelineEntry {
  id: number;
  page_id: number;
  date: string;
  summary: string;
  detail: string;
  source: string;
  provenance?: SourceRef;
  created_at: string;
}

export class TimelineStore {
  constructor(private pg: PGlite) {}

  async addEntry(
    pageSlug: string,
    entry: {
      date: string;
      summary: string;
      detail?: string;
      source?: string;
      provenance?: SourceRef;
    },
  ): Promise<void> {
    await this.pg.query(
      `INSERT INTO timeline_entries (page_id, date, summary, detail, source, provenance)
       SELECT id, $2, $3, $4, $5, $6 FROM pages WHERE slug = $1
       ON CONFLICT (page_id, date, summary) DO UPDATE SET
         detail = EXCLUDED.detail,
         source = EXCLUDED.source`,
      [
        pageSlug,
        entry.date,
        entry.summary,
        entry.detail ?? "",
        entry.source ?? "",
        entry.provenance ? JSON.stringify(entry.provenance) : null,
      ],
    );
  }

  async getTimeline(pageSlug: string): Promise<TimelineEntry[]> {
    const result = await this.pg.query(
      `SELECT te.* FROM timeline_entries te
       JOIN pages p ON p.id = te.page_id
       WHERE p.slug = $1
       ORDER BY te.date DESC`,
      [pageSlug],
    );
    return result.rows as TimelineEntry[];
  }
}

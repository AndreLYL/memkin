import type { PageStore } from "../store/pages.js";
import type { SourceState } from "./source-schedule.js";

const ALERT_SLUG = "system/alerts";

export interface AlertSource {
  source_id: string;
  state: SourceState;
}

export class AlertWriter {
  constructor(private readonly pages: PageStore) {}

  async update(alertSources: AlertSource[]): Promise<void> {
    if (alertSources.length === 0) {
      const existing = await this.pages.getPage(ALERT_SLUG);
      if (existing) await this.pages.deletePage(ALERT_SLUG);
      return;
    }

    const lines = alertSources.map((a) => {
      if (a.state.consecutive_failures > 0) {
        return `- **${a.source_id}**: 连续失败 ${a.state.consecutive_failures} 次，最后错误: ${a.state.last_error ?? "unknown"}。`;
      }
      return `- **${a.source_id}**: 连续 partial ${a.state.consecutive_partials} 次。`;
    });

    const content = [
      "---",
      "type: system-alert",
      `updated: ${new Date().toISOString()}`,
      "---",
      "",
      "## Active Alerts",
      "",
      ...lines,
      "",
    ].join("\n");

    await this.pages.putPage(ALERT_SLUG, content);
  }
}

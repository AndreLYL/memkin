import type { RawMessage } from "../../../core/types";
import type { CursorStaging } from "../cursor-staging";
import type { IFeishuHttpClient } from "../http-client";
import type { FeishuTask, SourceCheckpoint } from "../types";
import type { FeishuSource } from "./base";

export class TaskSource implements FeishuSource {
  readonly name = "tasks";

  constructor(private readonly client: IFeishuHttpClient) {}

  async *fetch(
    checkpoint: SourceCheckpoint | null,
    cursorStaging: CursorStaging,
  ): AsyncGenerator<RawMessage> {
    const updatedFrom = this.resolveStartTime(checkpoint);
    const params: Record<string, string> = { page_size: "50" };
    if (updatedFrom) {
      params.updated_from = updatedFrom;
    }

    let maxUpdatedAt = 0;

    for await (const page of this.client.paginate<FeishuTask>("/open-apis/task/v2/tasks", params)) {
      for (const task of page.items) {
        const updatedAtMs = Number.parseInt(task.updated_at, 10) * 1000;
        if (updatedAtMs > maxUpdatedAt) {
          maxUpdatedAt = updatedAtMs;
        }
        yield this.mapTask(task);
      }
    }

    if (maxUpdatedAt > 0) {
      cursorStaging.stage(this.name, "default", { last_update_time: maxUpdatedAt });
      cursorStaging.commit(this.name, "default");
    }
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  private resolveStartTime(checkpoint: SourceCheckpoint | null): string | undefined {
    const tasksCp = checkpoint?.default as { last_update_time?: number } | undefined;
    if (tasksCp?.last_update_time) {
      return Math.floor(tasksCp.last_update_time / 1000).toString();
    }
    return undefined;
  }

  private mapTask(task: FeishuTask): RawMessage {
    const parts: string[] = [];
    if (task.summary) parts.push(task.summary);
    if (task.description) parts.push(task.description);
    const content = parts.join("\n");

    const assignees =
      task.members?.filter((m) => m.role === "assignee").map((m) => ({ id: m.id })) ?? [];

    const followers =
      task.members?.filter((m) => m.role === "follower").map((m) => ({ id: m.id })) ?? [];

    const metadata: Record<string, unknown> = {
      task_id: task.guid,
      status: task.completed_at ? "completed" : "open",
      assignees,
      followers,
      priority: task.priority || "none",
    };

    if (task.due?.timestamp) {
      metadata.due_date = new Date(Number.parseInt(task.due.timestamp, 10) * 1000).toISOString();
    }
    if (task.completed_at) {
      metadata.completed_at = new Date(Number.parseInt(task.completed_at, 10) * 1000).toISOString();
    }
    if (task.url) {
      metadata.source_url = task.url;
    }

    return {
      platform: "feishu",
      channel: "tasks",
      contact: task.creator?.id ?? "unknown",
      timestamp: new Date(Number.parseInt(task.updated_at, 10) * 1000).toISOString(),
      content,
      direction: "received",
      metadata,
    };
  }
}

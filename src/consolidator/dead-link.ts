import { stringify as yamlStringify } from "yaml";
import type { PageStore } from "../store/pages.js";

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number }>;

const RECHECK_DAYS = 30;

export async function checkDeadLinks(
  pages: PageStore,
  fetchFn: FetchFn = defaultFetch,
): Promise<number> {
  const references = await pages.listPages({ type: "reference" });
  let checked = 0;

  for (const page of references) {
    const url = page.frontmatter.url as string | undefined;
    if (!url) continue;

    // Skip if checked within RECHECK_DAYS
    const lastChecked = page.frontmatter.last_checked_at as string | undefined;
    if (lastChecked) {
      const daysSince = (Date.now() - new Date(lastChecked).getTime()) / 86_400_000;
      if (daysSince < RECHECK_DAYS) continue;
    }

    let isDeadLink = false;
    try {
      const result = await fetchFn(url);
      isDeadLink = !result.ok;
    } catch {
      isDeadLink = true;
    }

    // Update frontmatter with dead_link status and last_checked_at
    const updatedFrontmatter: Record<string, unknown> = {
      ...page.frontmatter,
      dead_link: isDeadLink,
      last_checked_at: new Date().toISOString(),
    };
    const { title: _t, type: _ty, ...rest } = updatedFrontmatter;
    const newContent = `---\ntitle: ${page.title}\ntype: ${page.type}\n${yamlStringify(rest).trim()}\n---\n\n${page.compiled_truth}`;

    await pages.putPage(page.slug, newContent, {
      halflife_days: page.halflife_days,
    });

    checked++;
  }

  return checked;
}

async function defaultFetch(url: string): Promise<{ ok: boolean; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

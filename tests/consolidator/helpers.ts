import type { Database } from "../../src/store/database.js";
import type { GraphStore } from "../../src/store/graph.js";
import type { PageStore } from "../../src/store/pages.js";

export async function makeExpiredHotPage(
  pages: PageStore,
  pg: Database["pg"],
  slug: string,
  type: string,
  entitySlug?: string,
  graph?: GraphStore,
): Promise<void> {
  await pages.putPage(slug, `---\ntitle: ${slug}\ntype: ${type}\n---\n${type} content.`, {
    halflife_days: 90,
  });
  await pg.query("UPDATE pages SET expires_at = NOW() - INTERVAL '1 day' WHERE slug = $1", [slug]);
  if (entitySlug && graph) {
    await graph.addLink(slug, entitySlug, "mentions");
  }
}

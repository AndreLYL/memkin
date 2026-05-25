import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Database {
  private constructor(private _pg: PGlite) {}

  get pg(): PGlite {
    return this._pg;
  }

  static async create(dataDir?: string): Promise<Database> {
    const pg = new PGlite({
      dataDir,
      extensions: { vector },
    });

    const schema = readFileSync(join(__dirname, "schema.sql"), "utf-8");
    await pg.exec(schema);

    return new Database(pg);
  }

  async close(): Promise<void> {
    await this._pg.close();
  }
}

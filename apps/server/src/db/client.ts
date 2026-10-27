import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseOptions {
  /** Postgres search_path. Only tests set this, to use a throwaway schema. */
  searchPath?: string;
}

/** One connection pool for the whole server. */
export function createDatabase(databaseUrl: string, options: DatabaseOptions = {}) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ...(options.searchPath ? { options: `-c search_path=${options.searchPath}` } : {}),
  });
  const db: Database = drizzle({ client: pool, schema });
  return { db, pool };
}

/** Run a trivial query so a bad URL or password fails at startup, not on first use. */
export async function checkConnection(pool: Pool): Promise<void> {
  await pool.query("select 1");
}

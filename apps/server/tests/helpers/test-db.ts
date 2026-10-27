import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { Pool } from "pg";
import { loadEnvFileIfPresent } from "../../src/config.js";
import { createDatabase, type Database } from "../../src/db/client.js";

// Integration tests use the real local Postgres (DATABASE_URL from .env), but each
// test file gets its own throwaway schema ("test_<random>"), so real data in the
// public schema is never read or written. The schema is dropped afterwards.
// (The yuyufx role can't create databases, but it owns its database, so it can create schemas.)

const MIGRATIONS = fileURLToPath(new URL("../../../../drizzle", import.meta.url));

export interface TestDatabase {
  db: Database;
  schemaName: string;
  cleanup(): Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  loadEnvFileIfPresent(fileURLToPath(new URL("../../../../.env", import.meta.url)));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Integration tests need DATABASE_URL in .env (local Postgres).");

  const schemaName = `test_${randomBytes(6).toString("hex")}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`create schema "${schemaName}"`);

  const { db, pool } = createDatabase(url, { searchPath: schemaName });

  // Apply the real migration files. Drizzle writes foreign keys as "public"."table",
  // so point those at the test schema instead.
  for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS })) {
    for (const statement of migration.sql) {
      await pool.query(statement.replaceAll('"public".', `"${schemaName}".`));
    }
  }

  return {
    db,
    schemaName,
    async cleanup() {
      await pool.end();
      if (!schemaName.startsWith("test_")) throw new Error("refusing to drop a non-test schema");
      await admin.query(`drop schema "${schemaName}" cascade`);
      await admin.end();
    },
  };
}

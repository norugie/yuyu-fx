import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs from apps/server, so the repo-root .env is two levels up.
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error("DATABASE_URL is missing. Set it in .env at the repo root (see .env.example).");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "../../drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});

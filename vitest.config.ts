import { defineConfig } from "vitest/config";

// One test run across all workspaces. Each folder is its own Vitest project
// (apps/web picks up its vite.config.ts).
export default defineConfig({
  test: {
    projects: ["apps/*", "packages/*"],
    passWithNoTests: true,
  },
});

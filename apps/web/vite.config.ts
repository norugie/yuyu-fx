import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // Local only: bind to the loopback address, not the whole network.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Forward API calls to the Express server (keep in sync with PORT in .env).
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});

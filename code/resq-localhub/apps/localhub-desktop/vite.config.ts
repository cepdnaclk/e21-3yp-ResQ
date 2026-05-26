import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const currentDir = dirname(fileURLToPath(import.meta.url));
const sharedSourcePath = resolve(currentDir, "../../packages/shared/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@resq/shared": sharedSourcePath,
    },
  },
  server: {
    host: "0.0.0.0",
    port: 1430,
    strictPort: true,
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
});
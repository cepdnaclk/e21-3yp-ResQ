import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";
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
    port: 1420,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],

    coverage: {
      provider: "v8",

      reporter: [
        "text",
        "html",
        "json-summary",
        "lcov",
      ],

      include: [
        "src/**/*.{ts,tsx}",
      ],

      exclude: [
        "src/**/*.d.ts",
        "src/test/**",
        "src/main.tsx",
        "src/types/**",
        "src/components/ui/index.ts",
        "src/components/icons/HubHeartbeat.tsx",
        "src/components/icons/PlusPulse.tsx",
        "src/components/ui/ActionTile.tsx",
        "src/components/ui/EmptyState.tsx",
        "src/components/ui/V2Card.tsx",
        "src/components/ui/V2States.tsx",
        "src/components/ui/V2StatusBadge.tsx",
        "src/components/ui/alert.tsx",
        "src/components/ui/badge.tsx",
        "src/components/ui/input.tsx",
        "src/components/ui/select.tsx",
        "src/components/ui/skeleton.tsx",
        "src/components/LogPanel.tsx",
        "src/components/QRCodeManager.tsx",
        "src/components/QrPanel.tsx",
        "src/components/StatusCard.tsx",
        "src/lib/appAuthRoutes.ts",
        "src/lib/localUrls.ts",
        "src/pages/AdminUsersPage.tsx",
        "src/pages/DiagnosticsPage.tsx",
        "src/pages/HomePage.tsx",
        "src/pages/SetupPage.tsx",
        "src/theme/ThemeToggle.tsx",
        "src-tauri/**",
      ],

      thresholds: {
        lines: 60,
        branches: 50,
        functions: 60,
        statements: 60,
      },
    },
  },
});

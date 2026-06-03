# ResQ Local Hub

This folder contains the ResQ Local Hub workspace used for local development and demoing the full stack (desktop UI, backend API, and local MQTT broker).

This README reflects the current repository layout and the most common developer workflows.

## What this workspace contains

- apps/localhub-desktop: Tauri desktop application (React + Vite + TypeScript, Rust shell)
- services/hub-api: Spring Boot backend (Java)
- packages/shared: Cross-package TypeScript utilities
- infra/mosquitto: Mosquitto configuration files for local development
- scripts: helper scripts (see below)

Top-level files you can expect:

- .env.example
- .gitignore
- README.md (this file)
- package.json
- pnpm-lock.yaml (single lockfile for the workspace)

## Minimal repository structure

code/resq-localhub/
  apps/
    localhub-desktop/
      src/
      src-tauri/
      public/
      package.json
      tsconfig.json
      vite.config.ts
  services/
    hub-api/
      src/
      pom.xml
      mvnw
      mvnw.cmd
  packages/
    shared/
      src/
      package.json
  infra/
    mosquitto/
      mosquitto.conf
      mosquitto.dev.conf
      mosquitto.final-demo.conf
      acl.final-demo
      passwords.example
  scripts/
    test-live-fallback.ps1
    start-localhub-dev.ps1
  .env.example
  .gitignore
  README.md
  package.json
  pnpm-lock.yaml

## Quick start: Desktop development

From the workspace root, develop the desktop using `pnpm`:

```powershell
cd code/resq-localhub
pnpm install
pnpm run desktop:tauri:dev
```

Note: this project uses `pnpm` as the canonical package manager. Do not create or commit `package-lock.json` or other npm lockfiles.

## Run full local dev stack

You can start the full local development stack (Mosquitto broker, Spring Boot backend, and the Tauri desktop) with a single command from the workspace root:

```powershell
pnpm run dev:localhub
```

This runs the `scripts/start-localhub-dev.ps1` launcher which:

- starts the Mosquitto broker (in a new PowerShell window)
- starts the Spring Boot backend (`mvnw.cmd spring-boot:run`) in a new PowerShell window
- runs the desktop dev server (`pnpm run desktop:tauri:dev`) in the current terminal

If `mosquitto` cannot be resolved from PATH, the launcher will attempt `C:\\Program Files\\mosquitto\\mosquitto.exe` and will fail with a clear message if neither is available.

## Desktop developer workflow (single service)

- Start only the backend (in separate terminal):

```powershell
cd services/hub-api
.\\mvnw.cmd spring-boot:run
```

- Start only the desktop UI (in a terminal):

```powershell
cd apps/localhub-desktop
pnpm install
pnpm run desktop:tauri:dev
```

## Tests and verification

- Typecheck the workspace TypeScript: `pnpm run typecheck`
- Build the desktop: `pnpm run desktop:build`
- Run desktop tests: `pnpm run desktop:test`
- Run backend tests: `pnpm run backend:test`
- Create Tauri desktop build: `pnpm run desktop:tauri:build`

## Current scope

Full cloud sync is not implemented yet. Firmware-to-LocalHub end-to-end validation and final pairing workflow hardening are still in progress.

## Notes and housekeeping

- Keep only the root `pnpm-lock.yaml` in `code/resq-localhub` — do not commit additional lockfiles per workspace package.
- Do not commit `node_modules` or backend `target/` artifacts.
- The `infra/mosquitto` folder contains the broker configs used for development and demos; do not remove these files.

If you find any broken links in this README, please open a PR updating them to the current paths.

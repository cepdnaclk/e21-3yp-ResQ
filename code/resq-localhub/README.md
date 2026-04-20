# ResQ Local Hub Monorepo

ResQ Local Hub is a Windows-first, offline-capable desktop system for managing medical manikins, sessions, telemetry, and exports in training environments. It combines Electron, Fastify, React, SQLite, and MQTT for robust local operation and future cloud sync.

## Monorepo Structure

- **apps/desktop**: Electron + React desktop shell for instructors and trainees
- **apps/web**: React + Vite web dashboard for cloud and local access
- **services/api**: Fastify TypeScript backend for local API, pairing, sessions, exports
- **packages/shared**: Shared types, constants, schemas for all modules
- **packages/mqtt**: MQTT topic helpers and payload validators
- **packages/db**: SQLite data layer, migrations, repositories
- **packages/config**: Strongly typed environment and default config
- **packages/logging**: Simple structured logger for all modules

## Architecture Overview

- **Desktop App**: Electron main process, preload, renderer, service manager, IPC channels
- **Web App**: React dashboard with instructor, trainee, pairing, session, and login pages
- **API**: Fastify backend with plugin pattern, routes, controllers, services, repositories
- **DB**: SQLite with migration and repository stubs
- **MQTT**: Topic builder, payload validators, subscription helpers
- **Shared**: Types/interfaces/constants/schemas for clean module boundaries
- **Config/Logging**: App-wide config and logging, easy to extend

## Getting Started

### Install dependencies

```sh
pnpm install
```

### Run desktop app (development)

```sh
pnpm --filter apps/desktop run dev
```

### Run API backend (development)

```sh
pnpm --filter services/api run dev
```

### Run web dashboard (development)

```sh
pnpm --filter apps/web run dev
```

## What is Scaffolded

- Monorepo structure, workspace config, and starter files
- Electron desktop app: main, preload, renderer, service manager, IPC, UI stubs
- Fastify backend: plugin pattern, routes, controllers, services, repositories, mock JSON
- Web dashboard: router, layout, pages, placeholder cards, navigation
- Shared types, constants, schemas
- MQTT helpers and topic builder
- SQLite DB layer, migration, repository stubs
- Config and logging packages

## TODOs

- Business logic for pairing, sessions, exports, authentication
- Real DB queries and migrations
- Actual MQTT message handling
- UI polish and feature flows
- Cloud sync and advanced telemetry

## Recommended Implementation Order

1. config + logging
2. desktop service manager
3. API health endpoint
4. DB migration
5. shared types
6. MQTT topic helpers
7. instructor dashboard basics
8. pairing flow
9. session flow
10. exports

---

This scaffold is ready for feature-by-feature AI-assisted development. Extend each module independently and keep boundaries clean for maintainability.

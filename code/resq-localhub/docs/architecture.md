# Architecture Notes

This document will describe the high-level architecture of ResQ Local Hub.

- Desktop app (Electron) controls local services and hosts the web dashboard.
- Web dashboard implemented with React/Vite.
- API service built using Fastify; provides REST endpoints and live updates (websocket/Server-Sent Events).
- SQLite used for offline-first local storage via `@resq/db`.
- Shared code lives in packages to avoid duplication.

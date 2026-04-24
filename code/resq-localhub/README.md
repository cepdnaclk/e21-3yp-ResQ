# ResQ Local Hub (Rewrite)

This repository contains the new **ResQ Local Hub** foundation.

It is a Windows-first desktop application intended for an instructor PC to manage local services and run local-first sessions, even without internet.

## Stack (Initial Foundation)

- Desktop shell: Tauri
- Frontend: React + Vite + TypeScript
- Backend API: Spring Boot (Java 17)
- Local database direction: SQLite (to be wired in next steps)
- Local messaging direction: Mosquitto MQTT broker

## Product Direction

- Sessions should work locally without internet.
- Data is stored locally first.
- Cloud sync is planned later when connectivity is available.
- Docker is optional later for contributors and deployment experiments, but not required now.
- Repository structure is designed to be open-source friendly in future.

## Repository Layout

- `apps/localhub-desktop`: Tauri desktop app (React UI + Rust shell)
- `services/hub-api`: Spring Boot backend service
- `infra/mosquitto`: local Mosquitto configuration
- `docs`: architecture and planning notes

## Quick Start

### 1) Backend API

```powershell
cd services/hub-api
./mvnw spring-boot:run
```

Health endpoint:

```text
GET http://localhost:18080/api/hub/health
```

The desktop Home page checks this endpoint on load, so the backend should be running before you open the app if you want to see live API status.

The desktop Home page also includes `Start API` and `Stop API` buttons that launch and stop the backend from the Tauri app during development.

For broker lifecycle control from the desktop app, Mosquitto path resolution is:

- `MOSQUITTO_EXE` environment variable (if set), otherwise `mosquitto` from PATH
- `MOSQUITTO_CONF` environment variable (if set), otherwise `infra/mosquitto/mosquitto.conf`

The LAN Info card now reads hostname and primary local IPv4 from Tauri. If no non-loopback IPv4 is found, it shows `Not detected`.

When auto-detection cannot find a usable LAN IP, use Setup to save a manual LAN IP override. Home will then use the manual value.

### 2) Desktop App

```powershell
cd apps/localhub-desktop
npm install
npm run tauri:dev
```

## Current Scope

This first pass only creates a clean, runnable skeleton:

- Basic desktop pages and placeholder panels
- One Tauri command wiring example (`get_app_info`)
- One API health endpoint (`/api/hub/health`)
- Base Mosquitto config for local usage

No full pairing/session/cloud workflow is implemented yet.

## Next Steps

See:

- `docs/architecture-overview.md`
- `docs/open-source-plan.md`
- `docs/development-plan.md`

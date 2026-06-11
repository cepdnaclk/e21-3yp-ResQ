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

For a Windows-first local demo path, start with:

- [Local demo runbook](docs/local-demo-runbook.md)
- [Local demo launcher](scripts/local-demo/start-local-demo.ps1)
- [Local firmware simulator smoke test](docs/local-firmware-simulator-smoke-test.md)
- [Real ESP32 integration smoke test](docs/real-esp32-localhub-integration-smoke-test.md)
- [Local firmware integration handoff](docs/localhub-firmware-integration-handoff.md)

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

### LocalHub Cloud Roster Sync

To configure roster sync for the backend started by the Tauri app, create:

```text
C:\Users\<name>\.resq-localhub\cloud-sync.env
```

On other platforms, use `~/.resq-localhub/cloud-sync.env`. Start from
`apps/localhub-desktop/cloud-sync.env.example`, replace the placeholder values,
and restart the Tauri app.

The file accepts `KEY=value` lines, blank lines, and comments beginning with
`#`. Existing `RESQ_ROSTER_SYNC_*` process environment values take precedence
over values in the file, so manual PowerShell configuration continues to work.
Keep `cloud-sync.env` local because it contains the hub key.

For broker lifecycle control from the desktop app, Mosquitto path resolution is:

- `MOSQUITTO_EXE` environment variable (if set), otherwise `mosquitto` from PATH
- `MOSQUITTO_CONF` environment variable (if set), otherwise `infra/mosquitto/mosquitto.conf`

Local Mosquitto exposes two development listeners:

- TCP MQTT on `1883` for ESP32 devices and the backend subscriber
- MQTT-over-WebSocket on `9001` for future browser dashboard display clients

To verify the broker config directly:

```powershell
mosquitto -c infra/mosquitto/mosquitto.conf -v
Test-NetConnection localhost -Port 1883
Test-NetConnection localhost -Port 9001
```

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

## Role-Based Authentication

The local hub uses **offline-first, role-based authentication** with three roles:

- **ADMIN**: Full system control. Can create and manage user accounts, view diagnostics, and perform all instructor actions.
- **INSTRUCTOR**: Manages sessions and manikins. Can start/end sessions, pair devices, monitor live performance, and export session data.
- **TRAINEE**: Participates in sessions. Can view their assigned session results and live performance while active.

### User Creation Flow

1. **First Run**: When the app starts and no users exist, it shows a **"First Run Setup"** screen to create the initial ADMIN account.

2. **Admin User Management**: After signing in as ADMIN, open the **"Users"** tab to:
   - View all existing users (ADMIN, INSTRUCTOR, TRAINEE)
   - Create new INSTRUCTOR or TRAINEE accounts with username, display name, password, and role
   - Disable user accounts (preventing them from signing in)

3. **Login**: All users sign in with their username and password on the login screen.

### Authorization Enforcement

- **Backend**: Protected API endpoints check user role using `AuthService.requireRole(...)` and return `401 Unauthorized` for missing credentials or `403 Forbidden` for insufficient privileges.
- **Frontend**: Route guards (`ProtectedRoute`, `RoleBasedRoute`) prevent unauthorized access and show an "Access Denied" page for insufficient roles.
- **Audit Logging**: Login attempts, user creation, session start/end, and exports are recorded in the local SQLite audit log.

### Session & Data Access Control

- **ADMIN/INSTRUCTOR** can list, start, end, and export any session.
- **TRAINEE** can only view their own session results and live performance (matched by username).
- Public health endpoint (`/api/hub/health`) requires no authentication.

## Auth Smoke Test

Use these checks after pulling the auth slice:

1. Start the backend from `services/hub-api`.
2. Start the desktop app from `apps/localhub-desktop`.
3. Open the app with no existing auth cookie and confirm the first-run ADMIN setup screen appears.
4. Create the first ADMIN user, then confirm the app lands on the instructor flow.
5. Sign in as ADMIN, open the **"Users"** tab, and create an INSTRUCTOR and a TRAINEE account.
6. Log out and sign back in as INSTRUCTOR. Confirm you can open instructor views, start/end sessions, and export data. Diagnostics tab should be hidden.
7. Log out and sign in as TRAINEE. Confirm you can only open the trainee view and get access denied on instructor routes.
8. Log out as TRAINEE (no current session) and confirm the trainee dashboard shows "No active sessions".
9. Confirm a direct unauthenticated request to `/api/sessions` returns `401` and a TRAINEE request to `/api/sessions/list` returns `403`.
10. Confirm `GET /api/hub/health` still responds without auth.
11. Run `pnpm exec tsc --noEmit` in `apps/localhub-desktop` and `./mvnw -q -DskipTests compile` in `services/hub-api`.

## Next Steps

See:

- `docs/architecture-overview.md`
- `docs/open-source-plan.md`
- `docs/development-plan.md`
- `docs/local-demo-runbook.md`
- `docs/local-firmware-simulator-smoke-test.md`
- `docs/real-esp32-localhub-integration-smoke-test.md`
- `docs/localhub-firmware-integration-handoff.md`

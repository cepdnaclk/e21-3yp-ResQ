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

To configure roster sync for a backend launched automatically by the Tauri app, create:

```text
C:\Users\<name>\.resq-localhub\cloud-sync.env
```

On other platforms, use `~/.resq-localhub/cloud-sync.env`. Start from the placeholder template at
`apps/localhub-desktop/cloud-sync.env.example`, replace the placeholder values locally, and restart
the Tauri app.

The file accepts `KEY=value` lines, blank lines, and comments beginning with `#`. Supported keys are:

- `RESQ_ROSTER_SYNC_ENABLED`
- `RESQ_ROSTER_SYNC_BASE_URL`
- `RESQ_ROSTER_SYNC_HUB_ID`
- `RESQ_ROSTER_SYNC_HUB_KEY`
- `RESQ_ROSTER_SYNC_FIXED_DELAY_MS`
- `RESQ_ROSTER_SYNC_TIMEOUT_MS`

Environment variables already set on the Tauri process take precedence over values in this file, so
the existing manual PowerShell configuration continues to work. Keep the real file local; do not
commit hub credentials.

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

### Windows Release Build

The build machine needs Node.js, Rust, and a Java 17 JDK with `JAVA_HOME` set. The installed
application does not require Java because the release build creates and bundles its own runtime.

```powershell
cd apps/localhub-desktop
npm run tauri:build
```

This command rebuilds the Spring Boot JAR, creates the bundled Java runtime, builds the frontend,
and produces both NSIS and MSI installers under `src-tauri/target/release/bundle`.

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

## Release smoke-test (Local network + firmware)

- **Test localhost health**: `GET http://localhost:18080/api/hub/health` responds.
- **Test LAN health**: From another machine on the LAN, `GET http://<LAN_IP>:18080/api/hub/health` responds.
- **Test MQTT port**: Verify `1883` is reachable from the instructor PC and the ESP32.
- **Verify registration payload**: Firmware should receive a non-loopback MQTT host (not `127.0.0.1` or `localhost`).
- **If packaged app**: Ensure the app detected a LAN IP on startup (Tauri logs will show the selected IP) and the backend logs the advertised MQTT/HTTP addresses.

## ResQ AI Coach Feature

The **ResQ AI Coach** provides automated clinical analysis of CPR training session metrics, giving trainees and instructors localized, high-fidelity performance reviews.

### 1. What ResQ Coach Does
ResQ Coach evaluates completed CPR training history, detects performance issues (e.g. shallow compressions, incorrect compression rates, incomplete chest recoil, fatigue drops), and summarizes historical trends. It translates statistical metric distributions into natural language clinical feedback.

### 2. Local-First Architecture
The ResQ AI Coach is designed with a **local-first** processing model:
- All analysis logic, performance classification rules, and trend heuristics run locally on the local hub database (SQLite).
- This ensures high availability in low-connectivity areas (e.g., fields, mock clinics, offline training rooms) without sending training telemetry or user details over the internet.

### 3. Why Cloud is Optional
To support privacy-by-default and offline functionality, cloud-based LLM integration is completely optional. If internet connectivity is unavailable, the local rules engine generates natural language insights locally. A developer config toggle allows enabling cloud-based enhancement later:
```yaml
resq:
  coach:
    provider: local # Defaults to local rules engine. Change to 'cloud' for LLM support.
```

### 4. Data Used by the Coach
The coach analyzes metrics recorded across one or more completed training sessions:
- **Depth Accuracy**: Proportion of compressions reaching the recommended depth range (50-60 mm).
- **Rate Accuracy**: Proportion of compressions within the recommended speed range (100-120 cpm).
- **Recoil Error**: Percentage of compressions failing to completely release the chest at the top of the recoil stroke.
- **Fatigue Drop**: Decline in compression rate or depth over the course of the session.
- **Consistency Score**: Statistical variance in rate and depth pacing.
- **Pauses**: Counts and duration of excessive pauses in chest compressions.

### 5. Supported User Questions (Intent Detection)
The coach includes a simple intent classification system supporting five core training questions:
1. `"List my bad performances in the last 3 weeks"` - Identifies and details sessions failing one or more config thresholds.
2. `"What mistakes do I repeat most?"` - Flags recurring performance errors appearing in multiple sessions.
3. `"Am I improving?"` - Computes performance changes chronologically between early and late session lists.
4. `"What should I practice next?"` - Targets the trainee's weakest metrics with training recommendations.
5. `"Compare my last session with my best session"` - Contrasts overall scores and performance details between the latest and the top scoring run.

### 6. API Endpoint Documentation
- **Endpoint**: `POST /api/coach/query`
- **Security**: Requires a valid session token. Trainees can only query their own username/userID.
- **Request Body**:
  ```json
  {
    "userId": "string (required)",
    "question": "string (required)",
    "fromDate": "ISO Date (optional)",
    "toDate": "ISO Date (optional)"
  }
  ```
  *Note: If `fromDate` and `toDate` are omitted, the query defaults to the last 3 weeks.*
- **Response Body**:
  ```json
  {
    "answer": "string",
    "mainIssues": ["string"],
    "recommendations": ["string"],
    "badSessions": [
      {
        "sessionId": "string",
        "sessionDateTime": "ISO Instant",
        "overallScore": 75,
        "shortReason": "string",
        "recommendation": "string"
      }
    ],
    "trendDirection": "IMPROVING / DECLINING / STABLE / NOT_ENOUGH_DATA"
  }
  ```

### 7. Safety Limitations & Guardrails
To remain suitable for CPR clinical instruction, the following safety limits are enforced:
- **Training Focus**: All output is strictly restricted to CPR training performance metrics.
- **No Diagnostics**: ResQ Coach does not diagnose cardiovascular conditions or provide medical prognoses.
- **No Emergency Instructions**: It does not supply emergency instructions or step-by-step instructions for real-life emergencies.
- **No Medical Assessment Claims**: Responses cannot be used as official medical certification or hospital assessments.
- **Contextual Tagging**: Generated responses are prefixed with training tags: `"Based on your training session data..."`

### 8. Future Improvements
- **Cloud AI Integration**: Support optional external cloud providers (e.g. Gemini, OpenAI) to generate more descriptive narrative insights while remaining offline-first.
- **Personalized Coaching Profiles**: Track muscle memory decay patterns over months to send proactive recommendations and custom refresher training reminders.

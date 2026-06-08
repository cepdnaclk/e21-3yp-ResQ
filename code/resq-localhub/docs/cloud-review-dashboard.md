# ResQ Cloud Review Dashboard

## Purpose

Phase 6 adds a local, read-only dashboard for reviewing session summaries that
have completed the LocalHub-to-cloud sync pipeline and are stored in
PostgreSQL.

The dashboard does not participate in live training. It has no session start or
stop controls, pairing, calibration, diagnostics, firmware commands, or write
operations.

## Components

- PostgreSQL stores `cloud_session_summaries`.
- `services/cloud-api` exposes read-only session endpoints on port `19080`.
- `apps/cloud-dashboard` is a separate React, TypeScript, and Vite application
  running on port `1430`.

Routes:

- `/sessions` lists synced sessions.
- `/sessions/:cloudSessionId` shows one record and its raw contract payload.
- `/analytics` computes simple aggregate metrics in the browser.
- `/` redirects to `/sessions`.

## Start PostgreSQL

Use the locally installed Windows PostgreSQL service. Verify it is available:

```powershell
pg_isready -h localhost -p 5432
```

Database creation and environment setup are documented in
`docs/cloud-api-postgres.md`.

## Start Cloud API

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

Confirm:

```powershell
Invoke-RestMethod http://localhost:19080/api/cloud/health
```

## Start Cloud Dashboard

Install dependencies once:

```powershell
cd apps/cloud-dashboard
pnpm install
```

Run locally:

```powershell
pnpm dev
```

Open:

`http://localhost:1430/sessions`

## API Configuration

The dashboard uses:

```text
VITE_CLOUD_API_BASE_URL=http://localhost:19080
```

The default is already `http://localhost:19080`. To override it in PowerShell:

```powershell
$env:VITE_CLOUD_API_BASE_URL = "http://localhost:19080"
pnpm dev
```

The Cloud API permits read-only `/api/cloud/**` requests from localhost browser
origins. Sync POST behavior remains server-to-server and is not exposed through
the dashboard.

## Demo Flow

1. Start PostgreSQL.
2. Start `cloud-api`.
3. Start `hub-api` with `RESQ_CLOUD_SYNC_ENABLED=true`.
4. Complete and sync a LocalHub session.
5. Start `apps/cloud-dashboard`.
6. Open `/sessions` and select the synced record.
7. Review the detail page and formatted raw payload.
8. Open `/analytics` to see client-side aggregate metrics.

If `cloud-api` is stopped, the dashboard presents an API-unavailable state with
a retry action. An empty database presents a no-sessions state.

## Checks

```powershell
cd apps/cloud-dashboard
pnpm test
pnpm build
```

## Out Of Scope

- AWS deployment
- Cognito, JWT, or authentication
- Cloud user management
- Live telemetry
- Firmware or diagnostic commands
- Pairing and calibration controls
- Session start or stop controls

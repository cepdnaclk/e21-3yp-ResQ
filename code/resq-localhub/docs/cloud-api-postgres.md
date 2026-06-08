# ResQ Cloud API: Local PostgreSQL Phase 4

## Purpose

Phase 4 replaces the Cloud API's Phase 3 in-memory repository with persistent
PostgreSQL storage. The public HTTP endpoints and the versioned
`SESSION_SUMMARY` contract remain compatible.

This phase is local-only:

- PostgreSQL is installed directly on Windows.
- There is no AWS deployment or AWS SDK.
- LocalHub does not upload `sync_queue` records automatically.
- Docker and Docker Compose are not used.

The Cloud API listens on port `19080` by default.

## Create The Local Database

Open `psql` as the PostgreSQL administrator, commonly the `postgres` user:

```powershell
psql -U postgres
```

Create the local development user and database:

```sql
CREATE USER resq_cloud WITH PASSWORD 'resq_cloud_dev';
CREATE DATABASE resq_cloud OWNER resq_cloud;
GRANT ALL PRIVILEGES ON DATABASE resq_cloud TO resq_cloud;
```

The password above is a local development default. Override it through the
environment for any shared environment.

## Configuration

The service uses these environment variables:

| Variable | Default |
|---|---|
| `CLOUD_API_PORT` | `19080` |
| `CLOUD_DB_URL` | `jdbc:postgresql://localhost:5432/resq_cloud` |
| `CLOUD_DB_USERNAME` | `resq_cloud` |
| `CLOUD_DB_PASSWORD` | `resq_cloud_dev` |

Example PowerShell overrides:

```powershell
$env:CLOUD_DB_URL = "jdbc:postgresql://localhost:5432/resq_cloud"
$env:CLOUD_DB_USERNAME = "resq_cloud"
$env:CLOUD_DB_PASSWORD = "resq_cloud_dev"
```

## Run The Cloud API

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

Flyway applies
`src/main/resources/db/migration/V1__create_cloud_session_summaries.sql`
when the service starts.

## Table Design

`cloud_session_summaries` stores:

- A stable UUID `cloud_session_id`.
- A unique `idempotency_key`.
- Local hub and session identities.
- Common session fields for indexed queries.
- The complete incoming contract in PostgreSQL `JSONB`.
- Immutable `received_at` and mutable `updated_at` timestamps.

Indexes cover local identity, device, trainee, and receipt time.

## Idempotency

The key is:

`localHubId + ":" + localSessionId`

When `localHubId` is null or blank, it becomes:

`UNASSIGNED_LOCAL_HUB + ":" + localSessionId`

The first POST creates a row and returns HTTP `201` with `result=CREATED`.
A later POST using the same key updates the payload and extracted columns,
preserves `cloudSessionId` and `receivedAt`, and returns HTTP `200` with
`result=UPDATED`.

## API Examples

Health:

```powershell
Invoke-RestMethod http://localhost:19080/api/cloud/health
```

Post a session summary:

```powershell
$body = @{
  contractVersion = "resq.cloud.session-summary.v1"
  entityType = "SESSION_SUMMARY"
  localHubId = "HUB-001"
  localSessionId = "S-100"
  deviceId = "M01"
  traineeId = "trainee-1"
  startedAt = "2026-06-08T08:00:00Z"
  endedAt = "2026-06-08T08:01:30Z"
  durationMs = 90000
  status = "COMPLETED"
  totalCompressions = 40
  validCompressions = 36
  score = 92
  source = "LOCALHUB"
  generatedAt = "2026-06-08T08:01:31Z"
} | ConvertTo-Json

$created = Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:19080/api/sync/session-summaries `
  -ContentType "application/json" `
  -Body $body
```

List sessions:

```powershell
Invoke-RestMethod http://localhost:19080/api/cloud/sessions
```

Fetch by cloud session ID:

```powershell
Invoke-RestMethod "http://localhost:19080/api/cloud/sessions/$($created.cloudSessionId)"
```

Fetch by local identity:

```powershell
Invoke-RestMethod http://localhost:19080/api/sync/session-summaries/HUB-001/S-100
```

Equivalent curl health check:

```bash
curl http://localhost:19080/api/cloud/health
```

## Manual PostgreSQL Verification

Connect as the application user:

```powershell
psql -h localhost -U resq_cloud -d resq_cloud
```

Verify Flyway and the table:

```sql
SELECT installed_rank, version, description, success
FROM flyway_schema_history
ORDER BY installed_rank;

\d+ cloud_session_summaries
```

Inspect stored sessions and JSONB:

```sql
SELECT cloud_session_id,
       idempotency_key,
       device_id,
       score,
       received_at,
       updated_at
FROM cloud_session_summaries
ORDER BY received_at DESC;

SELECT payload_json
FROM cloud_session_summaries
WHERE idempotency_key = 'HUB-001:S-100';
```

Confirm idempotency after posting the same payload twice:

```sql
SELECT idempotency_key, COUNT(*)
FROM cloud_session_summaries
GROUP BY idempotency_key
HAVING COUNT(*) > 1;
```

The final query should return no rows.

## Tests

Automated tests use H2 in PostgreSQL compatibility mode because this phase
does not use Docker or Testcontainers:

```powershell
cd services/cloud-api
.\mvnw.cmd test
```

H2 verifies the Spring context, Flyway migration, repository behavior, and HTTP
contract. Manual PostgreSQL verification is still required to validate the
locally installed PostgreSQL instance and its `JSONB` behavior.

## Out Of Scope

- Docker and Docker Compose
- AWS and RDS
- Cognito or JWT authentication
- LocalHub sync worker or automatic upload
- Cloud dashboard
- Roster sync

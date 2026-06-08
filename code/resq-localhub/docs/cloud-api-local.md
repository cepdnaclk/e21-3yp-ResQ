# ResQ Cloud API: Local Phase 3

## Purpose

Phase 3 adds a separate Cloud API service that can receive the versioned
`SESSION_SUMMARY` contract produced by LocalHub. The service is a local-first
skeleton for validating the HTTP contract and idempotency behavior before
persistent cloud infrastructure is introduced.

The Cloud API is local-only. It does not deploy to AWS, and LocalHub does not
upload `sync_queue` items automatically.

The service listens on port `19080` by default.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/cloud/health` | Local Cloud API health and storage mode |
| `POST` | `/api/sync/session-summaries` | Accept one Phase 2 session summary |
| `GET` | `/api/sync/session-summaries/{localHubId}/{localSessionId}` | Find a record by idempotency identity |
| `GET` | `/api/cloud/sessions` | List all received records |
| `GET` | `/api/cloud/sessions/{cloudSessionId}` | Find one cloud-side record |

## Run Locally

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

Override the port with `CLOUD_API_PORT`.

## Curl Examples

Health:

```bash
curl http://localhost:19080/api/cloud/health
```

Post a Phase 2 session summary:

```bash
curl -X POST http://localhost:19080/api/sync/session-summaries \
  -H "Content-Type: application/json" \
  -d '{
    "contractVersion": "resq.cloud.session-summary.v1",
    "entityType": "SESSION_SUMMARY",
    "localHubId": "HUB-001",
    "localSessionId": "S-100",
    "deviceId": "M01",
    "traineeId": "trainee-1",
    "startedAt": "2026-06-08T08:00:00Z",
    "endedAt": "2026-06-08T08:01:30Z",
    "durationMs": 90000,
    "status": "COMPLETED",
    "totalCompressions": 40,
    "validCompressions": 36,
    "score": 92,
    "source": "LOCALHUB",
    "generatedAt": "2026-06-08T08:01:31Z"
  }'
```

List sessions:

```bash
curl http://localhost:19080/api/cloud/sessions
```

Get by cloud session ID:

```bash
curl http://localhost:19080/api/cloud/sessions/CLOUD_SESSION_ID
```

## Idempotency

The future idempotency key is:

`localHubId + ":" + localSessionId`

Until LocalHub has a stable hub identity, a null or blank `localHubId` uses:

`UNASSIGNED_LOCAL_HUB + ":" + localSessionId`

Posting the same key again returns `ALREADY_EXISTS` and the original
`cloudSessionId`; it does not add a duplicate.

The Phase 2 DTO shape is copied into this service to avoid coupling `cloud-api`
to `hub-api` internals. A later phase may extract a shared contract module.

## Out of Scope

- PostgreSQL
- AWS resources or deployment
- Cognito or JWT authentication
- Cloud dashboard
- LocalHub sync worker or automatic upload
- Roster sync

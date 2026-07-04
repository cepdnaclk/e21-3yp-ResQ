# LocalHub Cloud Sync Worker

## Purpose

Phase 5 connects the LocalHub SQLite `sync_queue` to the local Cloud API. A
background worker uploads completed, versioned `SESSION_SUMMARY` payloads after
local session completion.

## Offline-First Rule

Cloud sync is never part of live training or session completion. Local session
persistence, review, CSV/JSON export, MQTT commands, and SSE behavior continue
without the Cloud API.

Cloud sync is disabled by default:

```yaml
resq:
  cloud-sync:
    enabled: false
```

Enable local sync with:

```powershell
$env:RESQ_CLOUD_SYNC_ENABLED = "true"
$env:RESQ_CLOUD_SYNC_BASE_URL = "http://localhost:19080"
```

## Configuration

| Property | Environment variable | Default |
|---|---|---|
| `resq.cloud-sync.enabled` | `RESQ_CLOUD_SYNC_ENABLED` | `false` |
| `resq.cloud-sync.base-url` | `RESQ_CLOUD_SYNC_BASE_URL` | `http://localhost:19080` |
| `resq.cloud-sync.batch-size` | `RESQ_CLOUD_SYNC_BATCH_SIZE` | `10` |
| `resq.cloud-sync.fixed-delay-ms` | `RESQ_CLOUD_SYNC_FIXED_DELAY_MS` | `30000` |
| `resq.cloud-sync.request-timeout-ms` | `RESQ_CLOUD_SYNC_REQUEST_TIMEOUT_MS` | `5000` |
| `resq.cloud-sync.max-retry-count` | `RESQ_CLOUD_SYNC_MAX_RETRY_COUNT` | `10` |

## Status Transitions

Successful upload:

`PENDING -> SYNCING -> SYNCED`

Retryable failure:

`PENDING or RETRY_LATER -> SYNCING -> RETRY_LATER`

Terminal failure:

`RETRY_LATER -> SYNCING -> FAILED`

Successful rows remain in `sync_queue`. The worker sets `synced_at` and does not
delete payloads.

## Retry And Backoff

`PENDING` records are immediately eligible. `RETRY_LATER` records become
eligible after:

```text
min(15 minutes, 30 seconds * max(1, retryCount))
```

The same rule recovers a stale `SYNCING` record after an interrupted worker
run. Each failure increments `retry_count`, records `last_error` and
`last_attempt_at`, and becomes `FAILED` when the configured maximum is reached.

The worker processes at most `batch-size` records per scheduled run. One failed
record does not stop later records in the batch.

## Manual Success Test

1. Start locally installed PostgreSQL.
2. Start the Cloud API:

```powershell
cd services/cloud-api
.\mvnw.cmd spring-boot:run
```

3. Start LocalHub with sync enabled:

```powershell
$env:RESQ_CLOUD_SYNC_ENABLED = "true"
$env:RESQ_CLOUD_SYNC_BASE_URL = "http://localhost:19080"
cd services/hub-api
.\mvnw.cmd spring-boot:run
```

4. End a LocalHub session or create a pending queue item.
5. Inspect `GET /api/sync-queue` as an instructor and verify the item becomes
   `SYNCED` with `syncedAt`.
6. Verify PostgreSQL:

```sql
SELECT idempotency_key, cloud_session_id, received_at, updated_at
FROM cloud_session_summaries
ORDER BY received_at DESC;
```

## Failure Test

1. Stop the Cloud API.
2. Keep LocalHub running with cloud sync enabled.
3. End a session.
4. Verify local session completion and exports still work.
5. Inspect `sync_queue` and confirm the item becomes `RETRY_LATER`, with an
   incremented retry count and error details.
6. Repeated failed attempts eventually set the item to `FAILED`.

## Out Of Scope

- AWS resources or deployment
- Cloud dashboard
- Cognito, JWT, or cloud authentication
- Roster sync
- Firmware changes
- MQTT changes

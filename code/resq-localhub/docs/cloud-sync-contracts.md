# ResQ Cloud Sync Contracts

## Purpose

Phase 2 replaces the LocalHub sync queue's ad-hoc session-summary JSON with a stable, versioned Java DTO contract. This phase only defines and serializes local contracts into the existing SQLite outbox. It does not upload data.

ResQ LocalHub remains live and offline-first. Cloud sync is post-session only and must never block local session completion, review, or export.

No live telemetry, MQTT command, calibration, pairing, session control, or SSE live-stream behavior goes through cloud sync.

## Contract Version

The current session-summary contract is:

`resq.cloud.session-summary.v1`

The queue row continues to use `entity_type = SESSION_SUMMARY`, the local session ID as `entity_id`, `sync_status = PENDING`, and `retry_count = 0`.

## JSON Example

Optional fields that are unavailable are omitted from serialized JSON.

```json
{
  "contractVersion": "resq.cloud.session-summary.v1",
  "entityType": "SESSION_SUMMARY",
  "localSessionId": "S-100",
  "deviceId": "M01",
  "traineeId": "trainee-1",
  "startedAt": "2026-06-08T08:00:00Z",
  "endedAt": "2026-06-08T08:01:30Z",
  "durationMs": 90000,
  "status": "COMPLETED",
  "result": "COMPLETED",
  "totalCompressions": 40,
  "validCompressions": 36,
  "avgDepthMm": 51.5,
  "avgRateCpm": 108.0,
  "recoilOkPct": 95.0,
  "recoilOkCount": 38,
  "incompleteRecoilCount": 2,
  "pauseCount": 1,
  "score": 92,
  "flags": "DEPTH_OK,RATE_OK",
  "summaryNotes": "Strong overall attempt",
  "scenario": "adult-cpr",
  "source": "LOCALHUB",
  "generatedAt": "2026-06-08T08:01:31Z"
}
```

## Fields

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `contractVersion` | string | Required | `CloudSyncContractVersion.CURRENT` | Always `resq.cloud.session-summary.v1`. |
| `entityType` | enum/string | Required | Contract mapper | Always `SESSION_SUMMARY`. |
| `localHubId` | string | Optional | Future stable hub identity | Not currently available; omitted rather than invented. |
| `localSessionId` | string | Required | `SessionEndResponse.sessionId` | Local idempotency identity and queue `entity_id`. |
| `sessionId` | string | Optional | Future external/distinct session ID | Omitted while it is identical to `localSessionId`. |
| `deviceId` | string | Required | `SessionEndResponse.deviceId` | Local device identifier. |
| `manikinId` | string | Optional | Future session/manikin data | Not currently available. |
| `traineeId` | string | Optional | `SessionEndResponse.traineeId` | Omitted when no trainee identity was recorded. |
| `instructorId` | string | Optional | Future session data | Not currently available. |
| `startedAt` | ISO-8601 timestamp | Optional | Completed session response/summary | UTC instant when available. |
| `endedAt` | ISO-8601 timestamp | Optional | Completed session response/summary | UTC instant when available. |
| `durationMs` | integer | Optional | `SessionSummary.durationSeconds` | Existing seconds converted to milliseconds. |
| `status` | string | Optional | `SessionEndResponse.ended` | `COMPLETED` or `ACTIVE`. Queued items are expected to be completed. |
| `result` | string | Optional | `SessionEndResponse.ended` | `COMPLETED` or `UNKNOWN`; no outcome is invented. |
| `totalCompressions` | integer | Optional | `SessionSummary.totalCompressions` | Available completed-session metric. |
| `validCompressions` | integer | Optional | `SessionSummary.validCompressions` | Available completed-session metric. |
| `avgDepthMm` | number | Optional | `SessionSummary.avgDepthMm` | Average measured depth in millimeters. |
| `avgRateCpm` | number | Optional | `SessionSummary.avgRateCpm` | Average compressions per minute. |
| `recoilOkPct` | number | Optional | `SessionSummary.recoilPct` | Percentage value from the existing summary. |
| `recoilOkCount` | integer | Optional | `SessionSummary.recoilOkCount` | Count retained for consumers that need raw totals. |
| `incompleteRecoilCount` | integer | Optional | `SessionSummary.incompleteRecoilCount` | Count retained for consumers that need raw totals. |
| `pauseCount` | integer | Optional | `SessionSummary.pausesCount` | Contract uses singular `pauseCount`; source model remains unchanged. |
| `score` | integer | Optional | `SessionSummary.score` | Existing locally calculated score. |
| `flags` | string | Optional | `SessionSummary.latestFlags` | Latest locally available summary flags. |
| `summaryNotes` | string | Optional | `SessionEndResponse.notes` | User-entered/local notes only. |
| `scenario` | string | Optional | `SessionEndResponse.scenario` | Existing local scenario value. |
| `source` | string | Required | Contract mapper | Always `LOCALHUB`. |
| `generatedAt` | ISO-8601 timestamp | Required | Queue enqueue time | Time the contract payload was generated. |

Unknown JSON fields must be tolerated by future readers so additive contract changes remain forward-compatible. Breaking changes require a new contract version.

## Future Idempotency

The future cloud API should use `localHubId + localSessionId` as the unique idempotency key. `localHubId` is not available in this phase, so a future phase must add a stable LocalHub identity before uploads are implemented.

The local SQLite queue continues to prevent duplicates with its existing unique key on `entity_type + entity_id`.

## Out of Scope

- Cloud API
- PostgreSQL
- Sync worker
- AWS deployment
- Cloud dashboard
- HTTP clients, credentials, endpoints, or upload behavior

# Phase 6 — LocalHub MQTT validation, persistence, and bounded API/SSE

## Outcome

Phase 6 passes. LocalHub now consumes the Phase 5 firmware contract through one
canonical envelope, validates identity/order/classification/session/metrics
before persistence or mutation, isolates diagnostics from scoring, exposes
bounded typed live DTOs, and recovers across backend, broker, and SSE reconnects.
Production firmware runtime source was not changed.

The controlled runtime also found and fixed two simulator/integration harness
defects:

1. State-bearing simulator heartbeat/event/calibration/error packets omitted the
   production firmware's `boot_id` and `state_seq`.
2. LocalHub parsed only `profile_id` from the final calibration event, dropping
   the schema/generation/storage/version/hash identity required for strict session
   readiness.

The corrected final calibration identity was proved in a dedicated Java test and
in the broker/backend/simulator run before session start.

## Validation gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend clean test | PASS | 253 tests, 0 failures, 0 errors, 0 skipped |
| Backend package | PASS | Spring Boot `hub-api-0.1.1-SNAPSHOT.jar` |
| Desktop typecheck | PASS | `tsc --noEmit` |
| Desktop tests | PASS | 22 files, 100 tests; one-worker run used after parallel host-load timeouts |
| Desktop build | PASS with warning | 945 modules; 1,570.57 kB JS (431.05 kB gzip); existing chunk-size warning |
| Simulator contract | PASS | 20 tests, 0 failures; both simulator scripts syntax-clean |
| Firmware production build | PASS | `resq-firmware.bin` 0x11a920; 41% app partition free |
| Firmware test-app build | PASS | `resq_firmware_unity.bin` 0x65de0; 79% app partition free |
| Physical Unity/runtime | BLOCKED | No confirmed physical serial port; no hardware result claimed |
| Git whitespace | PASS | `git diff --check` |

The required desktop command was attempted twice under default parallelism. Its
only failures were nondeterministic five-second timeouts (93/100, then 96/100);
the same 100 tests passed with `--maxWorkers=1`, showing host contention rather
than assertion or product failures.

## Runtime scenarios

| Scenario | Result |
| --- | --- |
| One idle device | PASS |
| Manual `SENSOR_STREAM` start and stop | PASS; HTTP 202; no session scoring |
| Complete calibration | PASS; complete strict identity retained |
| Active session | PASS; start ACK, canonical metrics, completed summary |
| Invalid device ID | PASS; `IDENTITY_MISMATCH` |
| Wrong-session packet | PASS; `session is not active` |
| Contradictory metric | PASS; `depth_ok=false contradicts DEPTH_OK` |
| Duplicate status | PASS; `DUPLICATE_SEQUENCE` |
| Backend restart | PASS; retained/current evidence restored known `M01` |
| Broker restart | PASS; 15 subscriptions restored, status + heartbeat resumed |
| SSE reconnect | PASS; one initial snapshot/connection, failed emitters removed |

## Locked flows

Identity is topic-authoritative across status, heartbeat, both telemetry modes,
debug, general events, calibration, and error. Canonical and legacy topics share
one internal device ID. Mismatches are rejected before persistence, liveness,
registry mutation, scoring, or SSE and increment a bounded counter.

The approved session path is:

```text
receive → parse topic/JSON → canonical envelope → validate identity/order
→ classify mode → normalize/validate metrics → validate active session binding
→ persist approved normalized record → mutate registry/session → bounded SSE
```

The pre-Phase 6 path persisted broadly before family-specific validation. Raw
payload JSON that remains useful as internal critical/diagnostic evidence is
private and excluded from public DTO serialization.

## API/SSE and diagnostics

All measured ordinary responses were HTTP 200 with no `debugRaw`, `rawPayload`,
or serialized `payloadJson`. The active-device list was 1,736 bytes, individual
active device 1,734, active session 1,320, completed-session list/detail 886/884,
and health remained 277. Exact before/after limitations and SSE sizes are in
`phase-06-api-sse-payload-comparison.md`.

The existing bounded endpoint is:

```text
GET /api/devices/{deviceId}/firmware/diagnostics
```

It returned 200 for Admin/Instructor and 403 for Trainee. Histories are capped
and typed; stored payload JSON is not serialized.

## Compatibility and liveness

Legacy support remains inbound-only and measurable through:

- `legacyTopicMessageCount`
- `legacyPayloadAliasCount`
- `unorderedLegacyMessageCount`

Liveness uses backend `receivedAt`, not firmware uptime. Default thresholds are
12 seconds stale and 22 seconds offline. Controllable-clock tests cover one
missed heartbeat, stale/offline transitions, restoration, no uptime-as-epoch
interpretation, and rejected traffic not refreshing liveness.

## Findings

| ID | Priority | Area | Finding | Evidence | Resolution/next phase |
| -- | -------- | ---- | ------- | -------- | --------------------- |
| P6-01 | P1 resolved | Calibration identity | Final event metadata was dropped, blocking strict session readiness | Controlled runtime stayed schema/generation 0 before fix | Parsed and applied full identity; Java/runtime regression added |
| P6-02 | P1 resolved | Simulator contract | State-bearing simulator packets lacked production ordering fields | Calibration event ignored after retained sequenced status | Simulator injects shared boot-aware ordering; contract test added |
| P6-03 | P2 | Desktop build | Main JS chunk remains 1,570.57 kB minified | Vite build warning | Phase 7 scaling/performance work |
| P6-04 | P2 | Desktop tests | Default parallel run can exceed fixed 5-second limits on a loaded host | Timing-only failures; 100/100 passed with one worker | Consider CI worker cap or calibrated timeout separately |
| P6-05 | P2 blocked | Hardware | Physical firmware/Unity runtime not executed | No confirmed serial port | Hardware validation phase |

No unresolved P0 or P1 finding remains.

## Phase 7 boundary

Phase 7 still owns multi-device/load scaling, SSE/backpressure measurement under
20-device traffic, UI bundle optimization, and physical hardware validation.
No Phase 7 implementation or firmware tuning was started here.

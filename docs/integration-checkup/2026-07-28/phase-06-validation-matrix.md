# Phase 6 LocalHub validation matrix

All rows describe the post-Phase 6 order: validation completes before approved
persistence, registry/session mutation, and normal SSE publication.

| Topic/mode | Identity | Schema | Ordering | Session binding | Persistence | SSE/API | Result |
| ---------- | -------- | ------ | -------- | --------------- | ----------- | ------- | ------ |
| Canonical `status` | Topic authoritative; optional aliases must match | JSON object and typed state fields | `boot_id` + `state_seq`; stale/conflict/duplicate rejected | Reconciles only an existing session/device | Validated firmware event | Bounded live summary | PASS |
| Legacy `resq/manikins/{id}/status` | Normalizes to canonical ID; increments legacy counter | Same as canonical | Same sequence domain | Cannot create a second device | Same destination | Same DTO | PASS |
| `heartbeat` | Uniform alias validation | JSON object; firmware `ts_ms` retained as monotonic data | State-bearing ordering supported | None; receipt time refreshes liveness | Validated firmware event | Only meaningful liveness changes | PASS |
| `telemetry` / `SESSION_ACTIVE` | Topic ID must match aliases | Canonical or legacy discriminator; conflicts rejected; metrics/ranges/flags validated | Telemetry `seq` when present; cumulative counters monotonic | Explicit session exists, is active, matches device and payload | Normalized metric and runtime checkpoint only after validation | Canonical live/session update | PASS |
| `telemetry` / `SENSOR_STREAM` | Uniform alias validation | Typed bounded sensor snapshot | State ordering not applied blindly | Explicitly isolated from active session scoring | Latest diagnostic snapshot only | Diagnostic consumer only; no session SSE | PASS |
| `debug` | Uniform alias validation | JSON object | State ordering only when supplied | Never binds to scoring | Bounded diagnostic record | Protected diagnostics only | PASS |
| General `events` | Uniform alias validation | Typed/correlated event fields | Boot-aware sequence validation | Session events reconcile only their correlated request/session | Validated critical event | Bounded operational state only | PASS |
| `events/calibration` | Uniform alias validation | Typed result plus complete calibration profile identity | Boot-aware sequence validation | Cannot mutate active session totals | Calibration evidence/result after validation | Readiness/calibration stream only | PASS |
| `events/error` | Uniform alias validation | Typed error/event fields | Boot-aware sequence validation | No scoring mutation | Validated critical error | Bounded last-error state | PASS |
| Malformed topic/JSON | No identity accepted | Rejected before envelope completion | None | None | None | None | PASS |
| Identity mismatch | Rejected with bounded `IDENTITY_MISMATCH` reason | Payload not exposed | No state advance | No session effect | None | None | PASS |
| Duplicate status | Identity valid | Schema valid | Exact same boot/sequence/content rejected as duplicate | No reconciliation | None | None | PASS |
| Wrong-session telemetry | Identity valid | Metric schema valid | Does not advance accepted metric state | Rejected: session not active/mismatched | None | None | PASS |
| Contradictory metric | Identity valid | Rejected (`depth_ok=false` with `DEPTH_OK`) | Does not advance accepted counters | No scoring | None | None | PASS |

## Controlled runtime evidence

- Complete calibration produced `READY`, schema version 1, generation 1,
  storage `VALID`, profile version 1, and the expected 64-character profile hash.
- The subsequent authenticated session reached `SESSION_ACTIVE` and accepted
  canonical pressure balance and cumulative metrics.
- Invalid identity, wrong session, contradictory metric, and duplicate status
  produced bounded rejection reasons and no accepted-domain side effects.
- Broker restart reconnected both clients, resubscribed all 15 topic patterns,
  replayed one valid status, and resumed five-second heartbeats.
- Backend restart with broker/simulator left running recovered the known device
  through retained status/current heartbeat without creating a duplicate.
- Two SSE connections each received one initial snapshot; failed emitters were
  removed by the service test.

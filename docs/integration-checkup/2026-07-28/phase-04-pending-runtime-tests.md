# Phase 4 Pending Runtime-Test Matrix

These tests describe locked target behavior that would fail against current
production code. They are deliberately not committed as red tests.

## Phase 5 — firmware and simulator

| ID | Pending passing test | Reason it is pending |
| --- | --- | --- |
| P5-01 | Every firmware publish uses `resq/{deviceId}/...` only | production behavior is unchanged in Phase 4; verify after payload/topic cleanup |
| P5-02 | Minimal status omits device ID, IP, and diagnostic health/profile fields | current publisher emits the full compatibility payload |
| P5-03 | Status publishes once per effective `boot_id`/`state_seq` content transition | current manual-stream start path issues two fresh status publishes |
| P5-04 | Retained status remains QoS 1 through all state/LWT paths | rerun after status-builder reduction |
| P5-05 | Minimal heartbeat excludes diagnostics and duplicate identity | current heartbeat is intentionally unchanged |
| P5-06 | Heartbeat interval is measured at the selected idle/active/error policy | five seconds is a proposal pending production traffic/scaling evidence |
| P5-07 | `uptime_ms`/`ts_ms` migration has one authoritative monotonic representation | compatibility decision needs traffic evidence |
| P5-08 | Session telemetry contains only scoring/live fields and explicit active mode/state | current payload contains acquisition diagnostics |
| P5-09 | Firmware derives flags from metric booleans and cannot emit a contradiction | Phase 3 simulator capture demonstrates current non-conformance |
| P5-10 | Pressure centeredness uses `pressure_balance_score_pct` in [0,100] | future rename and alias rollout are not implemented |
| P5-11 | `CENTER` is consistent with the agreed score threshold | threshold must remain synchronized with LocalHub |
| P5-12 | Every command-result caller returns the command `request_id` as `reply_id` | legacy uncorrelated helper callers remain |
| P5-13 | Duplicate command request IDs replay a result without a second transition | verify firmware response cache around all command families |

## Phase 6 — LocalHub

| ID | Pending passing test | Reason it is pending |
| --- | --- | --- |
| P6-01 | Payload/topic ID mismatch is rejected for every message family before persistence | current enforcement is complete only in telemetry normalization |
| P6-02 | ID mismatch produces a rate-limited structured warning and no second device | common validator/log limiter does not yet exist |
| P6-03 | Malformed status/heartbeat/event/debug/calibration packets are rejected before persistence and mutation | canonical raw persistence currently precedes family validation |
| P6-04 | Unknown/invalid telemetry mode is rejected before high-rate persistence | persistence ordering is intentionally unchanged |
| P6-05 | `SENSOR_STREAM` can never reach session scoring or metric persistence | characterize and enforce at the reordered boundary |
| P6-06 | Debug and calibration packets can never reach session scoring | common family guard is still a target |
| P6-07 | Missing or mismatched active `session_id` is rejected before metric persistence/mutation | active-session binding currently occurs after generic persistence |
| P6-08 | `ts_ms` is never converted to wall-clock time or used for stale/offline decisions | add boundary/property tests around registry and persistence |
| P6-09 | `pressure_balance_score_pct` is canonical and old name is a bounded alias | DTO/parser migration not implemented |
| P6-10 | Boolean/flag contradictions are rejected with a stable reason | target common contract validator not implemented |
| P6-11 | Ordinary REST/SSE DTOs contain no `debugRaw` or unbounded original payload | explicit replacement endpoints/fields must land first |
| P6-12 | Sensor, debug, calibration evidence remains available after `debugRaw` removal | replacement coverage must be proven before removal |
| P6-13 | Internal MQTT topics and transport details never enter ordinary dashboard DTOs | add DTO serialization allow-list tests |
| P6-14 | Critical results/state/errors/audit events remain durable after persistence reordering | required regression guard |
| P6-15 | Canonical and compatibility traffic have equivalent validated domain effects during migration | legacy retirement safety |
| P6-16 | Legacy namespace can be disabled only after the documented observation gates pass | operational retirement control does not exist |
| P6-17 | Duplicate correlated results do not duplicate domain transitions | complete event/session/calibration idempotency coverage |

## Compatibility-test retirement

The passing canonical/legacy topic characterization and legacy full-payload
fixture tests remain until the retirement gates in the minimal contract are
met. Removing compatibility support is a deliberate release change, not a
cleanup side effect.

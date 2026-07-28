# Phase 4 Minimal MQTT and Public API Contract

## Scope and authority

This document locks the contract that later Phase 5 firmware work and Phase 6
LocalHub work must implement. Phase 4 changes fixtures, tests, and documentation
only; it does not reduce payloads or change runtime behavior.

Graphify was queried before direct inspection. Its small heuristic result pointed
at unrelated vendored JavaScript/TypeScript nodes, so every claim below was
verified against the current firmware and LocalHub source and the Phase 3
captures.

## 1. Topic namespace and device identity

The canonical namespace for firmware publications and LocalHub commands is:

```text
resq/{deviceId}/...
```

LocalHub temporarily accepts inbound compatibility topics under:

```text
resq/manikins/{deviceId}/...
```

The compatibility parser also maps legacy `resq/manikins/{deviceId}/live` to
telemetry. Firmware and new LocalHub publications must not emit the compatibility
namespace.

The device ID in the MQTT topic is authoritative. `device_id` and `deviceId` are
optional compatibility aliases only. A future LocalHub validator must reject a
present payload ID that differs from the topic ID before persistence, registry
mutation, session mutation, or SSE publication. It must emit a rate-limited
structured warning and must never create or update the payload-named device.

Current enforcement is partial. `TelemetryPayloadNormalizer.normalize(payload,
topicDeviceId)` rejects a mismatch for session telemetry. Status, heartbeat,
sensor-stream, debug, calibration, general-event, and error paths do not all
apply the same pre-persistence check. Canonical raw messages are currently
persisted before family-specific validation.

Compatibility may be retired only after:

1. deployed firmware publishes only canonical topics;
2. LocalHub command publishers and tests use only canonical topics;
3. broker observation over an agreed migration window records no legacy traffic;
4. persisted diagnostics identify no supported legacy device;
5. release notes announce removal and the compatibility parsing tests are
   deliberately deleted in the same change.

## 2. Timestamp semantics

`ts_ms` is firmware uptime from a monotonic clock. It is not Unix time.
`receivedAt` is LocalHub wall-clock receipt time.

LocalHub must preserve both values where ordering or audit needs them. Only
`receivedAt` may drive wall-clock stale/offline decisions. The current
`ManikinRegistryService` uses receipt time and defaults to a 12-second stale
threshold, which is compatible with the proposed five-second heartbeat but
leaves limited tolerance for two delayed packets.

## 3. Status

Canonical topic: `resq/{deviceId}/status`; QoS 1; retained.

Minimal target:

```json
{
  "state": "READY_FOR_SESSION",
  "session_active": false,
  "calibrated": true,
  "last_error_id": "00000",
  "boot_id": "0123456789abcdef",
  "state_seq": 10,
  "ts_ms": 123456
}
```

`state` is the firmware lifecycle state used by readiness, registry, recovery,
session side effects, and live DTOs. `session_active` provides explicit session
state. `calibrated` gates readiness and calibration UI. `last_error_id` supplies
the stable current error reason. `boot_id` plus `state_seq` orders retained and
live state across reboots. `ts_ms` preserves firmware event time.

`session_id` is conditional and is present only when a session is relevant.
`ready_for_session` remains a compatibility/derived convenience until LocalHub
derives it consistently from state and calibration. `device_id`, `event_id`,
pressure/hall health, pressure mode, profile echoes, and IP are not required in
the minimal status. IP has no identified runtime consumer that requires it in
this payload.

Status is published for a meaningful state transition or a necessary retained
state refresh. Firmware must avoid equivalent repeats with the same `boot_id`,
`state_seq`, state, and effective content.

The Phase 3 manual-stream duplicate is two fresh simulator publications, not
retained delivery. `startManualTelemetry()` calls `stopManualTelemetry()`, which
publishes status, and then calls `publishStatus(false)` itself. Phase 5 should
remove or coalesce the redundant call.

## 4. Heartbeat

Canonical topic: `resq/{deviceId}/heartbeat`; currently QoS 0 and not retained.

Minimal target:

```json
{
  "state": "READY_FOR_SESSION",
  "session_active": false,
  "sensor_running": false,
  "calibrated": true,
  "uptime_ms": 123456,
  "ts_ms": 123456
}
```

The registry/readiness/recovery paths consume state and session/calibration
state; sensor-stream control consumes `sensor_running`; liveness is established
by LocalHub receipt. `uptime_ms` and `ts_ms` currently contain the same monotonic
value. Keeping both is compatibility, not a demonstrated semantic need.
Phase 5 may retain `ts_ms` as the common timestamp and remove `uptime_ms` only
after compatibility measurement and UI/backend verification.

Heartbeat must not contain raw sensors, compression metrics, firmware display
messages, calibration evidence, IP, or profile detail.

The measurement proposal, not yet the final production setting, is:

- idle/ready: 5 seconds;
- active session: 5 seconds;
- error/recovery: 1–5 seconds when measurement justifies it.

No interval changes in Phase 4. A final interval requires production-firmware
traffic and scaling evidence. With the current 12-second stale threshold, a
five-second interval normally allows two missed/delayed heartbeats but has little
additional margin.

## 5. Telemetry modes

The following are separate contracts:

| Mode | Route | Permitted effect |
| --- | --- | --- |
| `SESSION_ACTIVE` | canonical telemetry | session binding, CPR scoring, live session/instructor SSE, session persistence |
| `SENSOR_STREAM` | canonical telemetry with explicit `telemetry_mode` | sensor-stream snapshot/UI only; never CPR scoring |
| calibration progress/evidence | `events/calibration` | calibration UI, command correlation, evidence/audit persistence |
| debug snapshot | `debug` | diagnostics UI/persistence only |

Only `SESSION_ACTIVE` telemetry contributes to CPR scoring.

Minimal session telemetry:

```json
{
  "session_id": "S-001",
  "state": "SESSION_ACTIVE",
  "depth_mm": 51.2,
  "depth_progress": 0.93,
  "depth_ok": true,
  "rate_cpm": 108,
  "compression_count": 18,
  "recoil_ok": true,
  "pause_s": 0.2,
  "hand_placement": "CENTER",
  "pressure_balance_pct": 93.5,
  "flags": "DEPTH_OK,RATE_OK,RECOIL_OK",
  "ts_ms": 123456
}
```

`session_id`, `state=SESSION_ACTIVE`, and `ts_ms` establish binding, mode, and
firmware time. A useful metric packet must contain at least one CPR measurement.
Depth, rate, recoil, pause, count, and hand-placement/balance fields are retained
where the accumulator, live DTO, or UI consumes them. Aggregate counters are
conditional when the firmware can supply them. Raw channels, masks, acquisition
lock state, stability counters, and calibration evidence are diagnostics and do
not belong in ordinary session telemetry.

Minimal `SENSOR_STREAM`, debug, command-result, calibration progress/result, and
error fixtures are locked in
`code/resq-localhub/docs/telemetry-api-update/fixtures/minimal-mqtt-contract-fixtures.json`.

## 6. Flags and pressure semantics

Metric booleans are authoritative. Firmware must generate the transmitted flag
representation from those booleans; it must not independently compute both.
LocalHub may validate the redundancy and reject contradictions. The exact
numeric bit allocation remains a team-confirmation item because current
captures and code also use a comma-separated `flags` representation.

The Phase 3 simulator produced `depth_ok=false` while `flags` contained
`DEPTH_OK`. The invalid fixture preserves that sample class and the simulator
contract test proves it is detected without making the current simulator test
suite red.

Current `ManikinRegistryService` computes:

```text
100 - abs(left - right) / (left + right) * 100
```

and marks values below 88 as skewed. Therefore `pressure_balance_pct` is a
centeredness score: 100 means perfectly centered and 0 means maximally
unbalanced. A `CENTER` placement must have a score of at least 88 under the
current threshold. Valid values are 0 through 100 inclusive.

The present name is ambiguous. The future canonical name should be
`pressure_balance_score_pct`; `pressure_balance_pct` remains an inbound/API
compatibility alias during migration.

## 7. Public REST/SSE boundary

Ordinary `ManikinLiveSummary`, `SessionLiveView`, and `LiveMetricPayload` objects
expose only fields required by their live UI and session views. MQTT topics,
transport details, raw sensor acquisition state, and unbounded original payloads
do not belong in these DTOs.

Current `TelemetryPayloadNormalizer` assigns the entire recognized firmware
telemetry object to `LiveMetricPayload.debugRaw`. The registry performs a
similar copy for sensor-stream-shaped data. This is explicitly temporary.

Before Phase 6 removes `debugRaw`, the following replacements must exist:

- `SensorStreamSnapshot` for raw/converted on-demand sensor streaming;
- persisted firmware debug snapshots and firmware diagnostics endpoints;
- calibration event/evidence DTOs for calibration samples, coefficients,
  validity, storage version, and audit evidence;
- explicit bounded live/session fields for every UI value in the fixture's
  `publicDtoCoverage` inventory.

## 8. Persistence

Target order:

```text
parse topic and JSON
  -> validate topic identity
  -> validate payload shape/family
  -> validate telemetry mode
  -> validate active session binding
  -> persist permitted high-rate telemetry
  -> mutate domain state and publish live views
```

Current canonical ingestion calls generic raw-message persistence before
message-family validation and dispatch. Phase 4 does not reorder it.

Critical command results, calibration results, state transitions, error events,
and audit records remain durable even when high-rate telemetry retention is
reduced. Phase 6 tests must prove invalid identity, shape, mode, and session
binding are rejected before high-rate persistence or mutation.

## 9. Commands and events

Commands carry `request_id`; their replies carry the same value as `reply_id`.
Important commands and events use QoS 1 and are not retained. Stable meaning is
encoded with numeric `event_id`, `reason_id`, `action_id`, and `progress_id`;
LocalHub/UI maps those IDs to display strings. Duplicate request IDs must replay
the prior correlated response and must not repeat a state transition.

Firmware's modern reply builders follow this rule and its request cache supports
idempotent redelivery. Remaining legacy callers of the uncorrelated
command-result helper must migrate in Phase 5; the helper emits command/status/
reason without the required correlation ID.

## 10. Backward-compatible examples

The fixture set contains both minimal target payloads and existing full status
and session-telemetry payloads. LocalHub continues accepting:

- camelCase and snake_case parser aliases already supported;
- optional matching payload device ID;
- legacy full payload fields;
- inbound legacy namespace and `live` telemetry suffix;
- `pressure_balance_pct` while the clearer score name is introduced.

Compatibility does not permit a payload/topic identity mismatch, ambiguous
telemetry mode, or contradictory metric booleans and flags in the target
contract.

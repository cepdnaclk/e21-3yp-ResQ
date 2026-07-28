# Phase 4 — Minimal MQTT and Public API Contract

## 1. Scope

Locked the intended minimal MQTT/public API contract before runtime reduction.
Added minimal, legacy, and invalid fixtures; passing backend and simulator
contract tests; field classification; and pending Phase 5/6 test matrices. No
production firmware, backend, desktop, or simulator runtime behavior changed.

## 2. Baseline

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting commit: `7bf086e0ed68999009e241b1ce23e14394630f98`
- Last completed phase on entry: Phase 3
- Worktree on entry: clean
- Graphify: queried without refresh because no source had changed at the
  checkpoint; the result was unrelated, so direct current-source inspection was
  authoritative.

## 3. Contract decisions

1. Canonical topics are `resq/{deviceId}/...`; only inbound LocalHub temporarily
   accepts `resq/manikins/{deviceId}/...`.
2. Topic device identity is authoritative; payload identity is optional
   compatibility data.
3. `ts_ms` is monotonic firmware uptime; `receivedAt` is backend wall clock and
   drives liveness.
4. Status is QoS 1, retained, transition-oriented, and boot/sequence ordered.
5. Heartbeat is minimal liveness/state only. Five seconds is an initial proposal,
   not a final interval; current LocalHub stale threshold is 12 seconds.
6. Session, sensor-stream, debug, and calibration traffic are distinct modes;
   only valid bound `SESSION_ACTIVE` telemetry may affect CPR scoring.
7. Metric booleans are authoritative and flags are derived.
8. Current pressure balance is a centeredness score (100 centered, below 88
   skewed); future canonical name is `pressure_balance_score_pct`.
9. Ordinary REST/SSE DTOs may not expose unbounded raw firmware payloads.
10. High-rate persistence follows validation in the Phase 6 target architecture.
11. Commands use `request_id`; replies echo it as `reply_id`; stable numeric IDs
    carry event/reason/action/progress meaning.

## 4. Exact retained-field consumers

The complete classification is in `phase-04-field-classification.md`.
Principal verified source consumers are:

- `DeviceRuntimeStateService`: `state`, explicit session state, `boot_id`, and
  `state_seq` ordering/recovery;
- `ManikinRegistryService`: receipt-time liveness, state/session/calibration,
  bounded latest metrics, pressure score and skew;
- `CalibrationCommandService`: online/stale/readiness and calibration gates;
- `TelemetryPayloadNormalizer`: payload/topic identity, session and metric
  aliases, numeric range checks, current `debugRaw`;
- `ActiveSessionService`: session binding, depth/rate/recoil/pause/count and
  hand-placement metrics;
- `SensorStreamService`: explicit `SENSOR_STREAM`, raw/converted requested
  values, validity, interval, firmware timestamp, and backend receipt;
- `MqttSubscriberService`: canonical/legacy routing, event/reply correlation,
  boot/sequence processing, family dispatch, and current persistence order;
- `MqttCommandPublisherService`: command `request_id`, QoS 1 publication and
  persisted command lifecycle;
- `LiveStreamService`, `ManikinLiveSummary`, `LiveMetricPayload`, and
  `SessionLiveView`: bounded instructor/session SSE and REST fields;
- desktop live/session/calibration/sensor views: connection/readiness and the
  bounded DTO fields, never direct MQTT transport fields.

## 5. Current versus target payloads

Current full status and telemetry examples are preserved under `legacyFull` in
the fixture. Target minimal examples are under `minimal`. Invalid examples lock
the depth flag contradiction, pressure score range, and active-session binding
rules.

Target status removes duplicated identity, IP, profile echoes, and sensor-health
detail. Target heartbeat removes connectivity/sensor/calibration diagnostics.
Target session telemetry removes acquisition internals while preserving actual
scoring/live consumers. Dedicated sensor-stream, debug, and calibration fixtures
retain diagnostic/evidence responsibilities.

## 6. Backward compatibility

LocalHub continues to parse the temporary legacy namespace, legacy `live`
suffix, matching optional payload IDs, existing full payload fields, and current
parser aliases. Retirement requires deployed-traffic observation, supported
device inventory, release communication, and deliberate test removal. A
topic/payload mismatch is not valid compatibility behavior.

## 7. Raw-capture findings

- The simulator contradiction `depth_ok=false` plus `DEPTH_OK` is captured as an
  invalid fixture and detected by the simulator contract test. Target rule:
  booleans authoritative, flags derived.
- `pressure_balance_pct` values near 93–95 with `CENTER` are consistent with the
  current centeredness calculation, not an imbalance percentage. The name will
  change after compatibility planning.
- The duplicate manual-stream startup status comes from two simulator calls:
  `startManualTelemetry()` invokes `stopManualTelemetry()` (which publishes
  status) and then invokes `publishStatus(false)` again. Phase 5 should coalesce
  it.

## 8. Files changed

- `code/resq-localhub/docs/telemetry-api-update/fixtures/minimal-mqtt-contract-fixtures.json`
- `code/resq-localhub/services/hub-api/src/test/java/lk/resq/localhub/service/MinimalMqttContractFixtureTest.java`
- `code/resq-localhub/services/hub-api/src/test/java/lk/resq/localhub/service/MqttSubscriberServiceTest.java`
- `code/resq-localhub/scripts/firmware-simulator/firmware-simulator-contract.test.js`
- `docs/integration-checkup/2026-07-28/phase-04-minimal-contract.md`
- `docs/integration-checkup/2026-07-28/phase-04-field-classification.md`
- `docs/integration-checkup/2026-07-28/phase-04-pending-runtime-tests.md`
- this report and Phase 4 command evidence logs.

## 9. Verification commands and results

```powershell
Set-Location code\resq-localhub\services\hub-api
.\mvnw.cmd test

Set-Location ..\..\apps\localhub-desktop
pnpm.cmd typecheck
pnpm.cmd test -- --reporter=dot
pnpm.cmd build

Set-Location ..\..
node --test scripts\firmware-simulator\firmware-simulator-contract.test.js
node --check scripts\firmware-simulator\firmware-simulator.js
node --check scripts\firmware-simulator\firmware-simulator-contract.test.js

Set-Location ..\resq-firmware
idf.py build
Set-Location test
idf.py build

Set-Location ..\..\..
git diff --check
```

Final regenerated evidence:

- backend: 228 tests, 0 failures, 0 errors, 0 skipped;
- desktop typecheck: passed;
- desktop tests: 22 files and 100 tests passed;
- desktop production build: passed, 945 modules transformed;
- simulator contract: 4 tests passed; both Node syntax checks passed;
- firmware production image: build passed;
- firmware Unity test application: build passed (compile/link only).

Warnings retained in evidence:

- backend JVM class-sharing warning and expected test-context broker connection
  warnings; an existing unchecked-operation compiler warning appears for
  `SessionControllerTest`;
- desktop build reports the existing mixed static/dynamic `authApi` import and
  the existing chunk-over-500-kB warning;
- firmware build warnings, if any, are retained verbatim in the evidence files.

## 10. Pending runtime work

Phase 5 owns firmware/simulator payload reduction, redundant status removal,
final measured heartbeat policy, derived flag generation, pressure-score rename
publication, and migration of all uncorrelated command-result callers.

Phase 6 owns uniform pre-persistence identity/shape/mode/session validation,
rate-limited mismatch warnings, persistence reordering, pressure alias migration,
bounded REST/SSE DTOs and `debugRaw` removal, critical-event durability
regressions, and compatibility retirement controls.

No Phase 5 or Phase 6 runtime implementation is included here.

## 11. Decisions requiring team confirmation

1. Exact numeric bit allocation and migration format for derived metric flags.
2. Release window and observation duration for removing the legacy namespace.
3. Final heartbeat interval after production firmware and scale measurements,
   including whether the 12-second stale threshold should change.
4. Public migration schedule for `pressure_balance_score_pct` and its old alias.
5. Which aggregate counters remain firmware-authoritative versus calculated by
   LocalHub.

## 12. Acceptance

**PASS**, subject to the final committed clean-worktree check. One canonical
contract and bounded compatibility policy are documented; each retained field
has a verified consumer/reason; diagnostic modes are separated; raw-capture
inconsistencies have passing fixture tests; future red behavior is mapped to
Phase 5/6; all required builds/tests pass; and no production runtime behavior was
changed.

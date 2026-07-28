# Phase 2 — MQTT, API, and Data-Flow Contract Inventory

## 1. Scope

Inventoried firmware MQTT publish/subscribe contracts, LocalHub compatibility subscriptions, QoS/retention, payload fields, command correlation, persistence, active-session processing, REST/SSE DTOs, and duplicated or misplaced data. No runtime behavior was changed.

## 2. Baseline

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting commit: `a734603`
- Ending commit: this report's containing commit
- Firmware version: repository firmware identity currently reports `0.1.0`
- LocalHub version: `0.1.1`
- Device ID: contract placeholder `{deviceId}`
- Hardware or simulator: source inspection only
- MQTT broker: not started
- Backend URL: `http://127.0.0.1:18080`

## 3. Commands Executed

```powershell
graphify query "Map the current firmware-to-LocalHub MQTT contract..."

rg -n "resq/|cmd/session|cmd/calibration|cmd/telemetry|events/calibration|events/error|heartbeat|telemetry|debug" `
  code/resq-firmware code/resq-localhub `
  -g "*.c" -g "*.h" -g "*.java" -g "*.ts" -g "*.tsx" -g "*.js" -g "*.md"

rg -n "device_id|deviceId|manikin_id|manikinId|session_id|sessionId|state|state_seq|boot_id|ts_ms|..." `
  code/resq-firmware code/resq-localhub

rg -n "@GetMapping|@PostMapping|@RequestMapping|record .*Request|record .*Response|class .*Request|class .*Response" `
  code/resq-localhub/services/hub-api/src -g "*.java"
```

Generated/vendor/build directories were excluded from the retained inventories. Direct source reads verified topic construction, subscription routing, payload builders/parsers, lifecycle side effects, DTO fields, and persistence behavior.

## 4. Files Changed

| File | Change | Reason |
| ---- | ------ | ------ |
| `phase-02-topic-inventory.txt` | Added | Retain topic-definition and usage search evidence. |
| `phase-02-payload-field-inventory.txt` | Added | Retain payload-field producer/consumer search evidence. |
| `phase-02-api-inventory.txt` | Added | Retain endpoint and request/response DTO search evidence. |
| `phase-02-contract-matrix.md` | Added | Declare purpose, QoS, retention, fields, compatibility, and duplication for every required topic. |
| `phase-02-data-flow.md` | Added | Trace MQTT ingestion through persistence, registry, sessions, SSE, REST, and exports. |
| `phase-02-report.md` | Added | Summarize Phase 2 results, risks, decisions, and acceptance. |

No firmware, backend, desktop, simulator, or infrastructure runtime file was changed.

## 5. Test Results

| Test | Expected | Actual | PASS/FAIL/BLOCKED |
| ---- | -------- | ------ | ----------------- |
| Required topic coverage | Matrix includes all required publish and command topics | Status, heartbeat, telemetry, debug, three event families, debug/telemetry/calibration/session/system commands documented | PASS |
| Namespace decision | Canonical and compatibility namespaces declared | Canonical `resq/{deviceId}` and inbound compatibility `resq/manikins/{deviceId}` documented | PASS |
| Identity decision | Topic ID authoritative; mismatch handling visible | Decision declared; current partial enforcement documented as a finding | PASS WITH FOLLOW-UP |
| Timestamp decision | Uptime not treated as wall-clock liveness | Backend `receivedAt`/`Instant.now()` drives registry staleness; firmware `ts_ms` retained separately | PASS |
| Duplicate-field inventory | Duplicates and misplaced diagnostics identified | Status/heartbeat overlap, duplicate uptime and accepted-count fields, session diagnostics, and DTO duplication documented | PASS |
| API DTO inventory | Requests/responses identified from source | Registration, session, calibration, sensor-stream, diagnostics, live, SSE, and export boundaries documented | PASS |
| Runtime behavior | No behavior changes in Phase 2 | Documentation and evidence only | PASS |

## 6. Traffic Measurements

Not measured in this phase. The matrix identifies expected high-volume families and candidate fields; Phase 3 will capture actual broker traffic and payload sizes before any reduction.

## 7. Findings

| ID | Priority | Area | Finding | Evidence | Proposed action |
| -- | -------- | ---- | ------- | -------- | --------------- |
| P2-F01 | P1 | Device identity | Topic device ID is used for routing, but a payload mismatch is explicitly rejected only by session telemetry normalization. Other families can update the topic device's state while carrying a conflicting payload ID. | `TelemetryPayloadNormalizer`, `MqttSubscriberService`, contract matrix | Add one common mismatch check before persistence/dispatch in the minimal contract-test phase, then decide reject versus quarantine. |
| P2-F02 | P1 | Public DTO boundary | Session telemetry recognized as firmware-shaped is copied wholesale into `LiveMetricPayload.debugRaw`, exposing internal diagnostics through live REST/SSE DTOs. | `TelemetryPayloadNormalizer`, `LiveMetricPayload`, `ManikinRegistryService` | Preserve required UI fields explicitly and remove/guard `debugRaw` in Phase 6 after contract tests. |
| P2-F03 | P1 | Storage/traffic | Every canonical message, including heartbeat and high-rate telemetry, is persisted as a generic firmware event before message-specific validation. | `MqttSubscriberService.persistCanonicalMessage` | Measure database write rate and retention impact in Phases 3 and 9; limit persistence by family only after evidence. |
| P2-F04 | P2 | Payload duplication | Heartbeat repeats most retained status/readiness data, and `uptime_ms` duplicates uptime-valued `ts_ms`. | Firmware heartbeat builder and matrix | Keep minimal liveness/ordering fields in heartbeat; retain state snapshots in status after Phase 3 measurements. |
| P2-F05 | P2 | Session telemetry | Normal telemetry includes extensive acquisition diagnostics and duplicates the accepted-pressure sample count under two names. | `telemetry_publisher.c`, payload inventory | Keep CPR metrics and compact validity/quality flags on telemetry; move detailed acquisition fields to debug in Phase 5. |
| P2-F06 | P2 | Correlation compatibility | A legacy firmware command-result helper still emits uncorrelated event payloads without `reply_id`. | `runtime_helpers_publish_command_result` callers | Migrate remaining direct callers to the correlated command-aware helper, backed by command idempotency tests. |
| P2-F07 | P2 | Compatibility | LocalHub accepts the legacy `resq/manikins/{deviceId}/live` suffix and normalizes it to telemetry, while shared TypeScript topic parsing is canonical-only. | `MqttSubscriberService`, shared `firmwareTopics` | Treat legacy MQTT as backend-only compatibility and add explicit tests/documented retirement criteria. |
| P2-F08 | P2 | Ordering | `boot_id`/`state_seq` are present on state/events but absent from telemetry/debug; legacy ordering can still consult firmware uptime. | `runtime_identity`, publishers, `DeviceRuntimeStateService` | Do not interpret `ts_ms` as wall-clock. Decide in Phase 5 whether high-rate telemetry needs an explicit sequence field. |

## 8. Regressions

None. This phase made no runtime changes and did not rerun the already-passing Phase 1 suites.

## 9. Decisions Required

| Question | Options | Recommendation | Owner |
| -------- | ------- | -------------- | ----- |
| Canonical MQTT namespace | Canonical only; canonical plus compatibility | Publish canonical only; keep backend compatibility subscriptions temporarily | Firmware/LocalHub team |
| Device-ID mismatch policy | Accept, reject, quarantine | Reject before domain mutation and persistence, with a rate-limited structured log; quarantine only if field diagnostics require it | LocalHub team |
| Timestamp semantics | Firmware wall clock; firmware uptime plus backend receive time | Keep `ts_ms` as uptime and use backend receive time for liveness/audit wall clock | Firmware/LocalHub team |
| Raw diagnostics in public live DTO | Preserve unbounded `debugRaw`; feature-gate; remove | Remove from normal live DTO after explicit UI field coverage is tested; keep dedicated diagnostics endpoints/streams | LocalHub/desktop team |
| Canonical persistence breadth | Persist every message; filter high-rate families; sampled retention | Measure first, then filter/sample heartbeat and telemetry while preserving command/audit events | LocalHub team |

The first three decisions are adopted as the working contract for subsequent phases.

## 10. Known Limitations

- The Graphify query located only a small heuristic neighborhood, so every material statement was verified directly against source.
- This inventory describes default QoS configuration; runtime property overrides can change LocalHub QoS values.
- No broker capture was taken, so field frequency and byte cost remain estimates until Phase 3.
- Firmware command validity is state-dependent; the matrix summarizes intended contexts rather than duplicating the complete state machine.
- Compatibility-topic messages are handled but not generically persisted, which means canonical and legacy observations are not audit-equivalent.

## 11. Acceptance Decision

- [ ] PASS
- [x] PASS WITH FOLLOW-UP
- [ ] FAIL
- [ ] BLOCKED

Reason: the required matrix, namespace/identity/timestamp decisions, duplicate-field inventory, data-flow trace, and API DTO inventory exist. The partial mismatch enforcement and public `debugRaw` leakage are explicit P1 follow-ups for the contract-test and normalization phases; no payload has been removed.

## 12. Commit

- Commit: this report's containing commit
- Message: `docs(mqtt): inventory firmware-localhub contracts and compatibility`
- Rollback point: `a734603`

# Phase 4 Field Classification

## Classification vocabulary

- **Required**: a verified current domain, DTO, scoring, liveness, or ordering
  consumer needs the field.
- **Conditional**: required only for a stated state, metric, or event.
- **Compatibility**: accepted during migration but not required in the minimal
  contract.
- **Diagnostics**: belongs in sensor-stream, debug, calibration evidence, or a
  diagnostics endpoint.
- **Derived LocalHub**: LocalHub can compute it from authoritative input.
- **Derived frontend**: presentation-only value computed from bounded DTO data.
- **Removable**: no retained normal-contract purpose after migration.

Topic `deviceId` is required for every family and is not repeated in each table.

## Status

| Field | Class | Verified consumer or reason |
| --- | --- | --- |
| `state` | Required | `DeviceRuntimeStateService`, `ManikinRegistryService`, readiness/recovery and session side effects, `ManikinLiveSummary` |
| `session_active` | Required | runtime/session reconciliation, registry and live/session views |
| `calibrated` | Required | readiness and `CalibrationCommandService`; live UI |
| `last_error_id` | Required | stable current-error/readiness reason without repeated prose |
| `boot_id` | Required | `DeviceRuntimeStateService` boot-aware ordering and retained-state recovery |
| `state_seq` | Required | stale/duplicate state rejection and session runtime ordering |
| `ts_ms` | Required | firmware monotonic event time; persisted separately from receipt time |
| `session_id` | Conditional | required only when state/session activity refers to a session |
| `ready_for_session` | Compatibility / Derived LocalHub | currently consumed by readiness paths; derivable from state/calibration/health |
| `pressure_mode`, pressure/hall validity and degraded flags | Diagnostics / Compatibility | calibration/readiness diagnostics; not minimal retained status |
| profile identity/version/hash | Diagnostics / Compatibility | audit/profile reconciliation, better placed in calibration/session events |
| `event_id` | Removable | retained snapshot topic already supplies message family |
| `device_id` | Compatibility / Removable | duplicates authoritative topic ID |
| `ip` | Removable from status | no source consumer requires it in the retained state payload |

## Heartbeat

| Field | Class | Verified consumer or reason |
| --- | --- | --- |
| `state` | Required | registry/readiness/recovery state refresh |
| `session_active` | Required | registry and session recovery |
| `sensor_running` | Required | sensor-stream control and live state |
| `calibrated` | Required | readiness refresh |
| `ts_ms` | Required | common firmware monotonic timestamp |
| `uptime_ms` | Compatibility | same value/clock as `ts_ms`; remove only after migration evidence |
| `boot_id`, `state_seq` | Compatibility | current ordering metadata; meaningful transitions remain status/event responsibility |
| Wi-Fi/MQTT/backend flags, IP, RSSI | Diagnostics | connectivity diagnostics, not minimum liveness |
| pressure/hall health and readiness detail | Diagnostics / Compatibility | dedicated readiness/calibration surfaces |
| raw sensors, compression/calibration data | Removable | prohibited from heartbeat |
| `device_id` | Compatibility / Removable | duplicates topic identity |

`receivedAt`, online, stale, offline, and connection state are **Derived
LocalHub**. The desktop displays them but firmware must not publish them.

## Session-active telemetry

| Field | Class | Verified consumer or reason |
| --- | --- | --- |
| `session_id` | Required | `ActiveSessionService` binding and live-session routing |
| `state=SESSION_ACTIVE` | Required | separates scoring telemetry from other telemetry modes |
| `ts_ms` | Required | ordered firmware metric time and `LiveMetricPayload.tsMs` |
| `depth_mm` | Conditional | live depth display and stored metric when available |
| `depth_progress` | Conditional | normalized/live depth and depth derivation path |
| `depth_ok` | Conditional | scoring/quality count and UI feedback |
| `rate_cpm` | Conditional | rate scoring and UI |
| `compression_count` | Conditional | session progress and aggregate display |
| `recoil_ok` | Conditional | recoil scoring and UI |
| `pause_s` | Conditional | pause metric and UI |
| `hand_placement` | Conditional | hand-placement feedback |
| `pressure_balance_pct` | Conditional / Compatibility | current live/UI score; future name `pressure_balance_score_pct` |
| `flags` | Compatibility / Derived LocalHub | redundant summary; must be generated from authoritative booleans |
| `valid_compression_count`, `recoil_ok_count`, `incomplete_recoil_count` | Conditional | current accumulators/live DTO and summaries when firmware supplies authoritative cumulative counts |
| `device_id` | Compatibility / Removable | topic ID is authoritative |
| `event_type` | Removable | topic plus state/mode identifies the family |
| raw pressure/hall, masks, validity/stability, lock/acquisition counters | Diagnostics | use sensor-stream/debug/calibration evidence |
| accepted-pressure duplicate counters | Removable | duplicate representation with no independent meaning |
| `debugRaw` | Removable public DTO field | unbounded original payload currently crosses normal REST/SSE boundary |

At least one CPR measurement is required in each session telemetry sample; not
every conditional metric must be present in every sample. Derived depth/rate
labels, progress colors, and presentation strings are **Derived frontend**.

## Sensor stream and debug snapshot

| Field group | Class | Verified consumer or reason |
| --- | --- | --- |
| `telemetry_mode=SENSOR_STREAM` | Required | `MqttSubscriberService`/`SensorStreamService` dispatch guard |
| debug `source` | Required | identifies direct snapshot origin |
| raw pressure channels and validity | Required when requested | calibration/sensor diagnostic UI |
| raw hall and validity | Required when requested | calibration/sensor diagnostic UI |
| converted kPa/mm/progress and validity | Required when requested | `SensorStreamSnapshot` and diagnostic UI |
| `pressure_saturation_mask` | Conditional diagnostics | acquisition/saturation diagnosis |
| stream `interval_ms` | Required for stream | UI/sample-rate interpretation |
| `ts_ms` | Required | firmware sample time |
| `device_id` | Compatibility / Removable | topic ID is authoritative |
| stability/last-stable/locking internals | Diagnostics | include only on an endpoint whose consumer needs them |

These fields must not feed `ActiveSessionService` scoring unless they arrive as a
valid, bound `SESSION_ACTIVE` metric contract.

## Commands, results, calibration, and errors

| Field | Class | Verified consumer or reason |
| --- | --- | --- |
| command `request_id` | Required | `MqttCommandPublisherService`, persisted command lifecycle, firmware idempotency cache |
| reply `reply_id` | Required | `MqttSubscriberService` correlation and session/calibration command completion |
| `event_id` | Required | stable event family/meaning |
| `status` or `result` | Required where applicable | ACK/NACK/result handling |
| `reason_id` | Conditional | stable failure/warning reason |
| `action_id` | Conditional | prescribed next action |
| `progress_id` | Conditional | calibration progress/result stage |
| `state` | Required for state-bearing replies/events | registry/readiness/session transitions |
| `boot_id`, `state_seq` | Required for state-bearing events | ordering/deduplication across reboots |
| `ts_ms` | Required | firmware event time |
| calibration coefficients/profile/storage evidence | Conditional diagnostics/audit | final calibration evidence persistence, not ordinary live DTO |
| calibration raw sample fields | Diagnostics | bounded calibration stream/evidence only |
| `error_code` | Required for error event | stable machine-readable failure |
| human-readable `message`, `reason`, `command` | Compatibility / Derived frontend | LocalHub/UI maps stable IDs to display text |
| `device_id` | Compatibility / Removable | topic ID is authoritative |

## Public DTO field coverage

`ManikinLiveSummary` retains device/session identity, receipt-time liveness,
firmware state/readiness, bounded latest CPR values, pressure score/skew, and
connection status because the instructor dashboard reads them.
`LiveMetricPayload` retains session metric values enumerated by
`publicDtoCoverage.sessionMetricRequired` in the fixture because
`SessionLiveView`, session SSE, and the session UI consume them.

Internal MQTT topics, QoS/retention, transport metadata, raw calibration/
acquisition fields, and the original unbounded payload are excluded from the
target ordinary DTO boundary. `debugRaw` remains current compatibility behavior
only until Phase 6 supplies dedicated replacement surfaces.

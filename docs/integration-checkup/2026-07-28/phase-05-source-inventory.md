# Phase 5 source inventory

Date: 2026-07-28

Baseline: `8ef24cc4e21409194d41128c6c2784023725b90b`

## Outgoing namespace

Production firmware constructs outgoing topics through `resq_mqtt_build_topic()` and publishes only `resq/{deviceId}/...`. LocalHub legacy subscriptions remain unchanged. Topic identity is authoritative; state-bearing payloads are normalized by `runtime_identity_ensure_json_payload()` without adding device identity fields.

## Payload and scheduling ownership

| Concern | Production source of truth | Simulator parity | Verification |
| --- | --- | --- | --- |
| Topic suffixes | `components/mqtt_manager/include/mqtt_topics.h` | `FirmwareSimulator.topic()` | contract tests and captures |
| Status shape/dedup | `components/firmware_mqtt_contract/firmware_mqtt_contract.c`, `mqtt_manager_publish_status()` | `publishStatus()` | firmware component tests; simulator tests 15–17 |
| Heartbeat shape | `firmware_mqtt_contract.c` | `publishHeartbeat()` | component tests; simulator tests 18–19 |
| Heartbeat cadence | `RESQ_HEARTBEAT_INTERVAL_MS`, stable deadline helper in `main/main.c` | `options.heartbeatIntervalMs` | build, scheduling tests, 120 s idle capture |
| Session snapshot | `cpr_metrics_normalize_snapshot()` | `normalizeSessionMetric()` | CPR, telemetry, simulator contract tests |
| Session payload | `telemetry_publisher_build_session_payload()` | `publishTelemetry()` | firmware payload tests and LocalHub fixture test |
| Sensor stream | `telemetry_publisher_build_sensor_stream_payload()` | `publishSensorStream()` | telemetry and simulator tests |
| Direct debug | `runtime_helpers_publish_debug_snapshot()` | `publishDebugSnapshot()` | runtime-helper and simulator tests |
| Calibration events | `calibration_manager` | `publishCalibrationEvent()` | firmware build, simulator tests and full capture |
| Command result | `runtime_helpers_publish_command_result_from_command()` | command capture/replay in `handleCommand()` | cache tests and simulator duplicate matrix |
| Request cache | `mqtt_manager.c` | `FirmwareSimulator.commandCache` | bounded-cache tests |

## Status publication paths

All paths use the same guarded status publisher. Unchanged effective content is suppressed, with `ts_ms` excluded from the comparison.

| Path | Visible change expected | Notes |
| --- | --- | --- |
| Boot / MQTT connect | yes | reconnect may force exactly one retained refresh |
| Paired idle / ready | yes | readiness and calibration changes are visible |
| Calibration start/pass/fail/cancel | yes | state and calibrated fields change |
| Session start/stop/interrupted | yes | state, session activity and conditional session ID change |
| Error/recovery | yes | state and last error change |
| Reset/turn-off | yes | terminal transition |
| Manual telemetry start/stop | no unless state changes | cleanup no longer creates an unchanged duplicate |
| LWT | broker-owned | simplified retained offline payload remains configured |

## Retained session counters and consumers

| Counter | Firmware owner | Current LocalHub consumer |
| --- | --- | --- |
| `compression_count` | CPR metrics snapshot | live telemetry and session summary |
| `valid_compression_count` | CPR metrics snapshot | quality summary |
| `recoil_ok_count` | CPR metrics snapshot | recoil summary |
| `incomplete_recoil_count` | CPR metrics snapshot | recoil summary |

The counters reset once at session start and remain cumulative until stop. Diagnostic streaming does not mutate them.

## Command ingress and result paths

`mqtt_manager.c` reassembles complete commands, requires a non-empty `request_id` (temporarily accepting legacy `command_id`), keys the volatile cache by full command topic plus ID, and queues a command only after the cache records it as pending. Completed duplicates replay the stored suffix and payload; pending duplicates are suppressed.

The production cache holds eight entries, expires completed entries after five minutes, recovers pending entries after two minutes, and clears on boot. The simulator cache holds 32 completed entries for five minutes and clears with the simulator process.

Physical-button events formerly routed through an uncorrelated command-result helper now use `runtime_helpers_publish_local_action_event()` and are explicitly marked `source=LOCAL_BUTTON`.

## LocalHub scope

Production LocalHub runtime code was not changed. Only the Phase 4 minimal fixture and `TelemetryPayloadNormalizerTest` were adjusted to validate the Phase 5 wire shape. Legacy topics, `debugRaw`, public DTOs, persistence ordering, and stale/offline behavior remain intact.

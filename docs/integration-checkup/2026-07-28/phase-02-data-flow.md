# Phase 2 Firmware-to-LocalHub Data Flow

## Runtime path

```text
Firmware state managers
  -> mqtt_manager topic/QoS/retention policy
  -> Mosquitto
  -> MqttSubscriberService topic parsing and JSON validation
     -> canonical raw-message persistence
     -> boot_id/state_seq readiness ordering
     -> telemetry normalization and session binding
     -> ManikinRegistryService receive-time liveness view
     -> ActiveSessionService lifecycle and metric accumulation
     -> calibration/sensor-stream services and persistence
     -> LiveStreamService instructor, session, calibration, and sensor SSE
  -> REST live/history/diagnostics/export DTOs
  -> desktop browser EventSource/fetch consumers
```

## Ingestion rules

1. Firmware publishes canonical topics under `resq/{deviceId}`.
2. LocalHub parses both canonical and `resq/manikins/{deviceId}` compatibility topics. The topic supplies the routing device ID.
3. Invalid JSON and unknown topics are rejected before domain processing.
4. Critical events are deduplicated with boot/sequence or correlation-based keys.
5. Canonical messages are persisted with both firmware `ts_ms` and `receivedAt=Instant.now()` before message-family dispatch. Compatibility messages are not passed to this generic persistence path.
6. Status, heartbeat, and critical events are ordered with `boot_id` and `state_seq` when available. Retained status also drives restart/recovery reconciliation.
7. `SENSOR_STREAM` telemetry is parsed into `SensorStreamSnapshot`; other named telemetry modes are rejected.
8. Session telemetry is normalized, checked against the topic device ID and active session binding, accumulated into the active session, and then published to instructor/session live views.
9. Command replies use `reply_id`, with request-ID aliases accepted by LocalHub, to update the persisted command record. Session start/stop replies advance `START_PENDING -> ACTIVE -> STOP_PENDING -> COMPLETED` or preserve the corresponding rejected/recovery state.
10. The registry uses backend receive time for `lastSeen` and the default 12-second stale threshold. Firmware uptime never acts as wall-clock time.

## Public HTTP and SSE contract

| Area | Endpoint | Principal request DTO | Principal response or event DTO |
| ---- | -------- | --------------------- | ------------------------------- |
| Registration | `POST /api/devices/register` | `DeviceRegistrationRequest(mac/device_mac, chip_id, firmware_version, device_label)` | `DeviceRegistrationResponse(ok, device_id, mqtt_host, mqtt_port)` |
| Registry/live | `GET /api/manikins`, `GET /api/manikins/live`, `GET /api/manikins/live/{deviceId}` | Path/query parameters | Registry records and `ManikinLiveSummary` |
| Instructor SSE | `GET /api/stream/manikins/live` | None | Immediate and subsequent `manikins-live` events containing `List<ManikinLiveSummary>`; 15-second SSE heartbeat |
| Session start | `POST /api/sessions/start` | `SessionStartRequest(deviceId, trainee/course identity, quick trainee or guest, profileId, scenario, notes)` | `SessionStartResponse` including session/device/profile/request IDs and lifecycle/recovery state |
| Session stop | `POST /api/sessions/end` | `SessionEndRequest(sessionId)` | `SessionStopResponse` including request/lifecycle/completion/reason/recovery fields |
| Session reads | `GET /api/sessions`, `/my-active`, `/my-history`, `/{sessionId}`, `/live/{sessionId}` | Path/query parameters | Session summaries/details and `SessionLiveView` |
| Session SSE | `GET /api/stream/sessions/live/{sessionId}` | Session path ID | Immediate and subsequent `session-live` events containing `SessionLiveView`; 15-second SSE heartbeat |
| Session export | `GET /api/export/sessions/{sessionId}.json`, `.csv`; `GET /api/sessions/{sessionId}/export` | Session path ID | Stored session summary/metrics in JSON or CSV |
| Calibration command | `POST /api/devices/{deviceId}/calibration/start`, `/cancel` | `CalibrationStartRequest` or no body for cancel | `CalibrationCommandResponse(deviceId, requestId, command, status, message, issuedAt)` |
| Calibration reads | `GET /api/devices/{deviceId}/readiness`, `/calibration/history`, `/latest`, `/history/{evidenceId}` | Device/evidence IDs | Readiness, calibration event/evidence/result DTOs |
| Calibration SSE | `GET /api/stream/manikins/{deviceId}/calibration` | Device path ID | Calibration stream/readiness events |
| Sensor stream control | `POST /api/devices/{deviceId}/telemetry/start`, `/stop` | START interval where applicable | Firmware command publish response |
| Sensor stream reads/SSE | `GET /api/devices/{deviceId}/telemetry/latest`; `GET /api/stream/devices/{deviceId}/sensor-stream` | Device path ID | `SensorStreamSnapshot` and sensor stream events |
| Firmware diagnostics | `GET /api/devices/{deviceId}/firmware/{commands,events,debug-snapshots,diagnostics}`; `POST .../debug` | Device path ID | Persisted command/event/debug records and `FirmwareDeviceDiagnosticsResponse` |

## DTO boundary observations

- `ManikinLiveSummary` and `SessionLiveView` intentionally combine connection, firmware readiness, active-session, and latest-metric data. They also repeat several top-level latest metric fields that already exist inside `LiveMetricPayload`.
- `LiveMetricPayload.debugRaw` is typed as `Object`. The normalizer assigns the entire original firmware telemetry object when it recognizes firmware-shaped telemetry, so internal diagnostic fields cross the public API/SSE boundary.
- `SensorStreamSnapshot` is a dedicated raw/converted sensor DTO and is a better boundary for on-demand diagnostics than embedding raw acquisition detail in normal session telemetry.
- Firmware timestamps and backend receive timestamps are stored separately in persistence records; this distinction must remain visible in future DTO cleanup.

## Source locations inspected

- Firmware: `mqtt_topics.h`, `mqtt_manager.c`, `runtime_helpers.c`, `telemetry_publisher.c`, `calibration_manager.c`, `session_active_manager.c`, `cpr_metrics`, and `runtime_identity`.
- LocalHub: `FirmwareTopics`, `MqttSubscriberService`, `TelemetryPayloadNormalizer`, `ManikinRegistryService`, `DeviceRuntimeStateService`, `ActiveSessionService`, `LiveStreamService`, `MqttCommandPublisherService`, controllers, DTOs, repositories, and desktop/shared topic consumers.

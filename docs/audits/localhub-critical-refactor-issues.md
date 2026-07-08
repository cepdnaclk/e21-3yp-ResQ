# LocalHub Critical Manikin Listing Audit

## Executive summary

LocalHub must treat the current firmware MQTT namespace, `resq/{deviceId}/...`, as the primary contract. The backend already builds command topics such as `resq/M01/cmd/session/start` and subscribes to both the current short namespace and the compatibility `resq/manikins/{deviceId}/...` namespace, so topic-family drift is not the leading suspect unless a deployment proves only `resq/manikins/+/...` is subscribed.

The critical demo path is vulnerable at the ingestion and presentation boundaries: MQTT messages can be received but fail to refresh the live registry, payload aliases can be missed, frontend filters can hide a valid publishing device, SSE can fail to deliver the initial or changed snapshot, and session start can use an identifier that does not match the live registry. The first implementation slice should prove `resq/M-DEV/status`, `resq/M-DEV/heartbeat`, and active-session `resq/M-DEV/telemetry` drive `/api/manikins/live`, SSE, and the dashboard without requiring a refresh.

## Root-cause map for manikin listing failures

1. Firmware publishes `resq/{deviceId}/status`, `heartbeat`, `telemetry`, or `events`.
2. `MqttSubscriberService` parses the topic and uses topic `deviceId` as the authoritative registry key.
3. Payload parsing must tolerate firmware aliases such as `device_id`, `deviceId`, `session_id`, `sessionId`, `session_active`, `sessionActive`, `manikin_id`, `manikinId`, and `ts_ms`.
4. `ManikinRegistryService` must update or create the in-memory device, refresh `lastSeen` from backend receive time, mark it online, and preserve stable identity across status, heartbeat, telemetry, events, and sessions.
5. `/api/manikins/live` must return the stable DTO shape expected by desktop dashboard code.
6. `/api/stream/manikins/live` must send an initial snapshot and publish later snapshots after registry changes.
7. Dashboard cards and launch flows must not hide valid online devices just because optional fields such as `paired`, `ready`, `calibrated`, or `sessionActive` are missing or false.
8. Session start must use the same `deviceId` shown in the live list and publish to `resq/{deviceId}/cmd/session/start`.

## Targeted issues

### CRITICAL-01: Current firmware topic ingestion and live registry update failure

- Severity: CRITICAL
- Affected files: `MqttSubscriberService`, `ManikinRegistryService`, `ManikinLiveController`, `LiveStreamController`, `LiveStreamService`, dashboard pages using `fetchLiveManikins` and `subscribeToManikinsLive`
- Suspected cause: the short topic family is supported, but tests and diagnostics were not centered on the current firmware path. Registry updates may miss aliases, use inconsistent identity keys, fail to refresh `lastSeen`, or publish incomplete SSE/API shapes.
- Acceptance criteria:
  - Publishing to `resq/M-DEV/status` lists `M-DEV` in `/api/manikins/live`.
  - Publishing to `resq/M-DEV/heartbeat` refreshes `lastSeen` and online state.
  - Publishing to `resq/M-DEV/telemetry` keeps the device online during a session.
  - Dashboard shows `M-DEV` without refresh.
  - SSE sends an initial snapshot and later updates.
  - Session start for `M-DEV` publishes to `resq/M-DEV/cmd/session/start`.
  - Stale/offline state is based on backend receive time, not firmware `ts_ms`.
- Recommended fix order: add regression tests for `resq/M-DEV/...`; verify registry alias handling; align API DTO shape; verify SSE initial/update behavior; then check dashboard filters.

### CRITICAL-02: MQTT contract normalization around the current firmware namespace

- Severity: CRITICAL
- Affected files: `FirmwareTopics`, `MqttSubscriberService`, `MqttCommandPublisherService`, MQTT tests, firmware integration docs
- Suspected cause: multiple topic/payload contracts exist in docs, shared helpers, tests, and compatibility code. The backend must make the current firmware namespace primary and normalize all accepted inbound variants to one `deviceId`.
- Acceptance criteria:
  - Primary command topics remain `resq/{deviceId}/cmd/session/start`, `resq/{deviceId}/cmd/session/stop`, `resq/{deviceId}/cmd/debug`, and `resq/{deviceId}/cmd/calibration/start`.
  - Subscriber accepts `resq/{deviceId}/status`, `heartbeat`, `telemetry`, and `events`.
  - Subscriber may also accept `resq/manikins/{deviceId}/...` as compatibility.
  - Internally, topic and payload aliases normalize to one stable `deviceId`.
- Recommended fix order: document primary versus compatibility contract; keep command publishing unchanged; expand parser and payload normalization tests.

### CRITICAL-03: Service readiness and startup orchestration

- Severity: CRITICAL
- Affected files: Tauri service layer, `HubHealthController`, frontend API base URL helpers, broker launch config
- Suspected cause: UI may show services as running before backend, broker, and DB are actually usable.
- Acceptance criteria: `/api/hub/health` reports backend, broker, DB, and version; Start Services validates broker, backend, and dashboard readiness; manikin listing waits for backend readiness.

### CRITICAL-04: Live registry persistence and recovery

- Severity: CRITICAL
- Affected files: `ManikinRegistryService`, persistence repositories, startup/bootstrap services
- Suspected cause: the live registry is in-memory only; known devices disappear after backend restart until MQTT is received again.
- Acceptance criteria: previously paired devices rehydrate as `OFFLINE` or `STALE`; retained `resq/{deviceId}/status` promotes a device online after restart.

### CRITICAL-05: Pairing, registration, and unknown-device handling

- Severity: CRITICAL
- Affected files: pairing/provision controllers, registry service, dashboard copy and filters
- Suspected cause: unknown publishing devices may be ignored or hidden when dev/demo mode should list them.
- Acceptance criteria: dev/demo mode lists unknown publishing devices predictably; secure mode rejects or quarantines unpaired telemetry without breaking the live list.

### CRITICAL-06: Session start depends on manikin identity and state

- Severity: CRITICAL
- Affected files: `ActiveSessionService`, `SessionController`, `MqttCommandPublisherService`, frontend session launch pages
- Suspected cause: selected dashboard ID, registry ID, command topic ID, and active-session ID can drift.
- Acceptance criteria: starting `M-DEV` publishes `resq/M-DEV/cmd/session/start`; offline/stale devices fail clearly with no ghost session; active session state reflects back into live listing.

### CRITICAL-07: SSE live stream reliability

- Severity: CRITICAL
- Affected files: `LiveStreamController`, `LiveStreamService`, frontend `liveEventsClient`, dashboard pages
- Suspected cause: emitter lifecycle, reconnect, event shape, or initial snapshot issues can make the dashboard stale.
- Acceptance criteria: opening dashboard receives initial `manikins-live` snapshot; status/heartbeat publishes immediate update; disconnect cleanup prevents duplicate emitters and leaks.

### HIGH-01: RBAC and protected actions

- Severity: HIGH
- Affected files: protected controllers and frontend guards
- Suspected cause: UI hiding may not match backend enforcement.
- Acceptance criteria: missing, invalid, or insufficient tokens return 401/403 for session start/end, pair/unpair, export, diagnostics/reset, and user management.

### HIGH-02: Diagnostics and logs are insufficient

- Severity: HIGH
- Affected files: MQTT subscriber/publisher, registry, SSE, session services
- Suspected cause: logs may not explain "device publishes but is not listed."
- Acceptance criteria: logs include `deviceId`, `topic`, `eventType`, `sessionId`, `state`, and source around receive, normalize, registry update, SSE publish, stale transition, command publish, and ACK/NACK.

### HIGH-03: Mock/simulator mode hides real hardware bugs

- Severity: HIGH
- Affected files: simulator clients, browser MQTT/live clients, dashboard mode indicators
- Suspected cause: simulator and real MQTT paths are not separated clearly enough.
- Acceptance criteria: UI indicates source and tests cover real MQTT publish path.

### HIGH-04: Database and DTO duplication

- Severity: HIGH
- Affected files: backend DTOs, frontend types, browser API normalizers
- Suspected cause: duplicated manikin models can diverge and hide fields needed by the UI.
- Acceptance criteria: backend response shape is documented and frontend uses one typed model.

### HIGH-05: Stale/offline timing and clock handling

- Severity: HIGH
- Affected files: `ManikinRegistryService`, telemetry normalizer, stale monitor tests
- Suspected cause: firmware `ts_ms` is uptime and must not be treated as epoch wall-clock freshness.
- Acceptance criteria: online/stale/offline uses backend receive time and thresholds are configurable.

## Refactor risks

- Changing command topics away from `resq/{deviceId}/cmd/...` would break current firmware.
- Tightening session-start validation can break tests or demo flows unless seeded devices are marked online and ready first.
- Adding persistent registry state can make stale devices appear in dashboards unless UI distinguishes known/offline from live/online.
- Changing SSE event names or payload shape can silently break dashboard updates.
- Treating `ts_ms` as wall-clock time can mark devices stale/offline immediately.
- Rejecting unknown devices too early can hide real hardware during local demos.

## Final implementation checklist

- [ ] Keep `resq/{deviceId}/...` as the primary firmware namespace.
- [ ] Add regression tests for `resq/M-DEV/status`, `heartbeat`, and active-session `telemetry`.
- [ ] Verify `lastSeen` is backend receive time and refreshes on status/heartbeat/telemetry/events.
- [ ] Normalize payload aliases without changing outward API shape.
- [ ] Align `/api/manikins/live` DTO with frontend fields.
- [ ] Prove SSE initial snapshot and later update behavior.
- [ ] Prove session start publishes `resq/M-DEV/cmd/session/start`.
- [ ] Run manual smoke:
  - `mosquitto_sub -h <broker-ip> -p 1883 -t "resq/#" -v`
  - `mosquitto_pub -h <broker-ip> -p 1883 -r -t "resq/M-DEV/status" -m "{\"event_id\":1001,\"device_id\":\"M-DEV\",\"state\":\"PAIRED_IDLE\",\"session_active\":false,\"session_id\":\"\",\"calibrated\":false,\"hall_range_raw\":0,\"pressure_contact_threshold\":0,\"pressure_valid_threshold\":0,\"ip\":\"192.168.8.161\",\"ts_ms\":5324}"`
  - `mosquitto_pub -h <broker-ip> -p 1883 -t "resq/M-DEV/heartbeat" -m "{\"device_id\":\"M-DEV\",\"wifi_connected\":true,\"mqtt_connected\":true,\"session_active\":false,\"sensor_running\":false,\"session_id\":\"\",\"calibrated\":false,\"ip\":\"192.168.8.161\",\"force1_ok\":true,\"force2_ok\":true,\"hall_ok\":true,\"compression_count\":0,\"ts_ms\":5824}"`
  - Confirm `/api/manikins/live`, dashboard listing, `lastSeen`, SSE update, stale/offline transition, and `resq/M-DEV/cmd/session/start`.

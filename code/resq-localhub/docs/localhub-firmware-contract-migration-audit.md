# LocalHub Firmware Contract Migration Audit

Phase 0 only: baseline audit and safety setup. This document records the current code paths that must be preserved or replaced in later migration phases. It does not change runtime behavior.

## A. Repository Structure

The workspace is split into three primary runtime surfaces plus a shared package:

- `services/hub-api`: Spring Boot backend that owns authentication, sessions, live fan-out, MQTT ingress/egress, and local SQLite persistence.
- `apps/localhub-desktop`: React/Vite desktop shell plus Tauri runtime that starts the backend and MQTT broker, exposes browser-safe dashboards, and provides LAN/setup utilities.
- `packages/shared`: Shared types used by the frontend and other JS code paths.
- `infra/mosquitto`: Broker config and ACL files used by the local Mosquitto instance.

The current architecture is still centered on the legacy manikin namespace and legacy live payload assumptions. That means the migration should be treated as a contract replacement, not a small topic rename.

## B. MQTT Topics and Message Builders

### Current backend subscriptions

`services/hub-api/src/main/java/lk/resq/localhub/service/MqttSubscriberService.java` currently subscribes to:

- `resq/manikins/+/status`
- `resq/manikins/+/heartbeat`
- `resq/manikins/+/telemetry`
- `resq/manikins/+/events`
- `resq/manikins/+/live`

The parser assumes the old path shape `resq/manikins/{deviceId}/{kind}`. It does not understand the new firmware contract namespace yet.

### Current backend command publication

`services/hub-api/src/main/java/lk/resq/localhub/service/MqttCommandPublisherService.java` publishes session control commands to:

- `resq/manikins/{deviceId}/cmd/session/start`
- `resq/manikins/{deviceId}/cmd/session/stop`

The payloads are legacy JSON commands with no `request_id`, `reply_id`, or command-response correlation fields.

### Current desktop MQTT assumptions

`apps/localhub-desktop/src/lib/mqttLiveClient.ts` also assumes the same legacy `resq/manikins/...` topic shape for browser live subscriptions. The live client currently treats telemetry, heartbeat, status, and events as separate legacy kinds.

### Firmware contract that still needs to be introduced

The target contract described for the migration uses the new `resq/{deviceId}/...` namespace and expects command/result correlation through `request_id` and `reply_id`. It also introduces explicit command type IDs, event IDs, and a firmware state list that are not yet represented in code or shared types.

Because the exact enumerations are not yet codified in this repository, Phase 1 should add shared contract types first and make every MQTT publisher/subscriber depend on those types instead of hard-coded topic strings.

## C. Backend Subscriber and Publisher Code

### MQTT ingress

`MqttSubscriberService` is currently the core ingress path. It:

- parses inbound topic strings
- normalizes JSON payloads
- updates the registry/service state
- validates telemetry against the active session
- forwards live updates into SSE/polling views

The service currently handles legacy `status`, `heartbeat`, `telemetry`, `events`, and `live` semantics. It also accepts legacy `device_id` / `session_id` aliases and allows `debugRaw` to survive normalization.

### Session command publishing

`MqttCommandPublisherService` is the only current command publisher. It is session-centric and emits legacy session start/stop commands only. There is no request/reply lifecycle, no retry tracking, and no command audit table behind those outbound messages.

### Session lifecycle authority

`ActiveSessionService` is the backend authority for starting and ending sessions. It currently:

- creates in-memory and persisted session records
- validates telemetry binding by device and session
- tracks sequence monotonicity
- publishes MQTT start/stop commands through the command publisher

The firmware migration must not bypass this authority. Instead, the new command/status flow should be layered into it so the backend remains the source of truth for session control.

## D. Device Registration and Provisioning

### Current registration/provisioning surface

`services/hub-api/src/main/java/lk/resq/localhub/controller/ManikinProvisionController.java` exposes `POST /api/manikins/pair-request` and returns a pairing token tied to a deviceId.

`apps/localhub-desktop/src-tauri/src/commands.rs` mirrors that behavior in `get_provisioning_data()` and `refresh_pairing_token()`. It fetches the same pairing token and assembles a hardcoded provisioning URL containing:

- SSID
- password
- broker host
- broker port
- token

### Desktop orchestration

`apps/localhub-desktop/src-tauri/src/main.rs` auto-starts the Mosquitto broker and backend on setup. `apps/localhub-desktop/src-tauri/src/broker_service.rs` resolves broker configuration from `infra/mosquitto/mosquitto.conf`, while `apps/localhub-desktop/src-tauri/src/api_service.rs` launches the Java backend with `mvnw spring-boot:run`.

### Audit conclusion

Device registration is still expressed as legacy pairing rather than a firmware state machine. The next migration phase should separate:

- device identity registration
- firmware provisioning/bootstrap
- command/reply correlation

## E. Database Schema and Persistence

The backend uses inline SQLite schema creation in repository constructors rather than a migration framework.

### Existing tables

`services/hub-api/src/main/java/lk/resq/localhub/service/LocalAuthRepository.java` creates:

- `users`
- `auth_sessions`
- `audit_logs`
- `trainee_records`

`services/hub-api/src/main/java/lk/resq/localhub/service/LocalSessionRepository.java` creates:

- `sessions`
- `session_metrics`

### Missing persistence for the new firmware contract

There are no tables yet for:

- command requests or replies
- firmware events
- calibration runs
- device state transitions
- firmware debug/raw payload capture beyond the current live payload field

This matters because the new contract introduces request/reply correlation and event tracking. Those should be persisted before frontend behavior changes, otherwise the live UI will only show partial state.

### Schema migration risk

Because schema creation currently happens inline, the migration will need a clear strategy for adding tables without breaking existing local installs. That likely means introducing explicit schema versioning or additive creation logic before any destructive cleanup.

## F. Frontend Assumptions

### Live data normalization

`apps/localhub-desktop/src/lib/liveClientTypes.ts` and `apps/localhub-desktop/src/lib/liveClient.ts` still normalize legacy telemetry-style payloads. They accept:

- `current_delta` / `currentDelta` as a fallback for `depthMm`
- legacy `feedback` values mapped into flags
- source modes including `real`, `simulator`, `calibration`, and `debug`

Those are compatibility helpers for the old contract, but they will conflict with the new firmware model if left in place unchanged.

### Dashboards and API wrappers

The browser-side API wrappers still assume old endpoints and shapes:

- `apps/localhub-desktop/src/lib/browserSessionsApi.ts`
- `apps/localhub-desktop/src/lib/browserManikinsApi.ts`
- `apps/localhub-desktop/src/lib/browserManikinRegistryApi.ts`
- `apps/localhub-desktop/src/lib/browserManikinsProvisionApi.ts`

The dashboards in `apps/localhub-desktop/src/pages/InstructorDashboard.tsx` and `apps/localhub-desktop/src/pages/TraineeDashboard.tsx` still render legacy manikin-oriented inventory and live fields such as force balance and pressure skew.

### App shell behavior

`apps/localhub-desktop/src/App.tsx` routes the desktop shell and browser-safe pages, while `apps/localhub-desktop/src/lib/accessUrls.ts` and `apps/localhub-desktop/src/lib/accessHost.ts` control LAN URL generation and manual host overrides.

The important point for the migration is that the frontend already has a layered live-source model, so later changes should flow through the live client abstraction instead of being copied directly into page code.

## G. Live-Update Paths

The live path currently works in this order:

1. MQTT WebSocket live client from the browser.
2. SSE fallback from the backend.
3. Polling fallback from the backend.

### Browser live orchestration

`apps/localhub-desktop/src/hooks/useLiveSession.ts` creates the browser live client and reads MQTT dashboard credentials from environment variables.

`apps/localhub-desktop/src/lib/liveClient.ts` manages the source selection and health state.

`apps/localhub-desktop/src/lib/mqttLiveClient.ts` parses MQTT messages.

`apps/localhub-desktop/src/lib/sseLiveClient.ts` consumes:

- `/api/stream/sessions/live/{sessionId}`
- `/api/stream/manikins/live`

`apps/localhub-desktop/src/lib/pollingLiveClient.ts` falls back to:

- `/api/sessions/live/{sessionId}`
- `/api/manikins/live/{deviceId}`

### Backend fan-out

`services/hub-api/src/main/java/lk/resq/localhub/service/LiveStreamService.java` and `MqttSubscriberService` are the backend fan-out path for live updates into SSE and registry snapshots.

### Audit conclusion

The live path is already layered, which is good, but it is still carrying legacy topic names and payload shapes. That means the migration should replace the contract at the transport boundary first and preserve the source-selection fallback behavior until the new contract proves stable.

## H. Tauri Orchestration

`apps/localhub-desktop/src-tauri/src/main.rs` is the app bootstrap. It wires the commands and auto-starts the broker and backend.

`apps/localhub-desktop/src-tauri/src/commands.rs` provides:

- network detection
- provisioning payload generation
- dashboard URL generation
- pairing-token refresh

`apps/localhub-desktop/src-tauri/src/broker_service.rs` manages Mosquitto lifecycle and configuration resolution.

`apps/localhub-desktop/src-tauri/src/api_service.rs` manages backend lifecycle.

`apps/localhub-desktop/src-tauri/build.rs` is currently a plain Tauri build hook.

### Audit conclusion

The Tauri shell is not where the new contract should live. It should remain a coordinator for broker/backend lifecycle and LAN setup, while the shared contract, backend MQTT logic, and frontend live client absorb the actual migration.

## I. Compatibility Risks

These are the highest-risk compatibility gaps identified in Phase 0:

- Legacy namespace drift: the codebase still centers on `resq/manikins/...` instead of `resq/{deviceId}/...`.
- Missing request/reply correlation: no `request_id` / `reply_id` tracking exists in the command flow.
- Legacy telemetry normalization: `current_delta`, `currentDelta`, and `feedback` fallbacks can mask contract mismatches.
- No firmware event model: calibration/error/debug event IDs are not represented as first-class types yet.
- No state-machine gating: session control is still backend-session-centric, not firmware-state-centric.
- Inline schema creation: adding new persistence tables needs an additive, compatibility-safe approach.
- Desktop provisioning hardcodes assumptions: SSID, password, and pair-request semantics are embedded in Tauri commands.

These are not bugs by themselves today. They are migration hazards because they will hide contract regressions if the new firmware behavior is introduced incrementally without a shared type layer.

## J. Phase-by-Phase File Map

### Phase 1: Shared contract and topic model

Likely first edits:

- `packages/shared/src/index.ts`
- `packages/shared/src/constants/*`
- `packages/shared/src/types/*`
- `services/hub-api/src/main/java/lk/resq/localhub/model/*`
- `apps/localhub-desktop/src/lib/liveClientTypes.ts`

Goal: define the canonical `resq/{deviceId}/...` topics, command type IDs, event IDs, request/reply envelope, and state list in one shared place.

### Phase 2: Backend MQTT migration

Likely first edits:

- `services/hub-api/src/main/java/lk/resq/localhub/service/MqttSubscriberService.java`
- `services/hub-api/src/main/java/lk/resq/localhub/service/MqttCommandPublisherService.java`
- `services/hub-api/src/main/java/lk/resq/localhub/service/ActiveSessionService.java`
- `services/hub-api/src/main/java/lk/resq/localhub/service/ManikinRegistryService.java`
- `services/hub-api/src/main/java/lk/resq/localhub/service/TelemetryPayloadNormalizer.java`

Goal: switch to the new firmware topics and data model while keeping the backend authoritative for session and live-state transitions.

### Phase 3: Persistence and auditability

Likely first edits:

- `services/hub-api/src/main/java/lk/resq/localhub/service/LocalAuthRepository.java`
- `services/hub-api/src/main/java/lk/resq/localhub/service/LocalSessionRepository.java`
- new repository/service files for commands, events, and calibration records

Goal: persist command/reply history and device events so the migration can be verified and debugged.

### Phase 4: Frontend live client and dashboards

Likely first edits:

- `apps/localhub-desktop/src/lib/liveClient.ts`
- `apps/localhub-desktop/src/lib/mqttLiveClient.ts`
- `apps/localhub-desktop/src/lib/sseLiveClient.ts`
- `apps/localhub-desktop/src/lib/pollingLiveClient.ts`
- `apps/localhub-desktop/src/pages/InstructorDashboard.tsx`
- `apps/localhub-desktop/src/pages/TraineeDashboard.tsx`

Goal: move UI consumers onto the new live contract without reintroducing contract logic in page components.

### Phase 5: Desktop orchestration and provisioning cleanup

Likely first edits:

- `apps/localhub-desktop/src-tauri/src/commands.rs`
- `apps/localhub-desktop/src-tauri/src/main.rs`
- `apps/localhub-desktop/src-tauri/src/broker_service.rs`
- `apps/localhub-desktop/src-tauri/src/api_service.rs`

Goal: remove hardcoded provisioning assumptions and align the desktop shell with the new device onboarding flow.

## K. Later-Phase Verification Commands

Use these checks after implementation phases begin:

- Backend build: `cd services/hub-api && mvnw test`
- Desktop build: `cd apps/localhub-desktop && pnpm test`
- Desktop type/build check: `cd apps/localhub-desktop && pnpm build`
- MQTT topic smoke test: publish sample messages against the new namespace and confirm backend live updates reach `/api/stream/sessions/live/{sessionId}` and `/api/stream/manikins/live` equivalents after the migration.
- Broker/runtime check: confirm Mosquitto starts through Tauri and the backend health endpoint still reports `ok=true`.

For the migration itself, the best verification order is:

1. Compile shared contract types.
2. Validate backend MQTT ingress and command publication.
3. Validate persistence for command/event records.
4. Validate frontend live fallback behavior.
5. Validate desktop broker/backend orchestration.

## L. Summary

The current system is operational, but it is still a legacy manikin-oriented implementation. The biggest migration risk is that several layers independently encode the old topic names and payload fallbacks. The safest path is to introduce a shared contract first, then migrate backend MQTT handling, then persistence, then frontend consumers, and only after that clean up the desktop provisioning flow.

Runtime backend changes were introduced later during Phase 2, but the audit guidance above still captures the remaining migration sequence.

## M. Phase 1 Status

- Files added: `packages/shared/src/firmware/*`, `services/hub-api/src/main/java/lk/resq/localhub/model/firmware/*`, `apps/localhub-desktop/src/lib/firmwareContract.test.ts`, and backend firmware contract tests under `services/hub-api/src/test/java/lk/resq/localhub/model/firmware/*`.
- Contract definitions added: canonical `resq/{deviceId}/...` topic builders, firmware state constants, command/event IDs, request-id helpers, and payload interfaces/records for the new firmware envelope.
- Intentionally not migrated yet: the backend MQTT subscriber/publisher flow, frontend dashboards, database schema, and Tauri provisioning logic still use the legacy paths and behavior.
- Next phase recommendation: wire the backend MQTT services to these new contract helpers first, then migrate persistence for request/reply and event tracking.

## N. Phase 2 Status

- Backend MQTT boundary updated additively: `MqttSubscriberService` now recognizes canonical `resq/{deviceId}/...` firmware topics while still accepting the legacy `resq/manikins/...` forms.
- `MqttCommandPublisherService` now publishes canonical firmware command topics with `request_id` and `issued_at_ms` payload fields, while the legacy session start/stop entrypoints remain available to existing callers.
- `TelemetryPayloadNormalizer` now accepts the firmware-style snake_case telemetry fields such as `depth_progress`, `depth_ok`, `valid_compression_count`, and `hand_placement` without removing the earlier fallbacks.
- `ManikinRegistryService` now recognizes `event_id`-based calibration and error packets and keeps the live summary/session view updates compatible with the existing runtime model.
- Validation completed: the hub API test suite passed after the backend change set was applied.
- Remaining work: persistence for command/reply history, frontend live-client migration, and desktop orchestration cleanup are still deferred to later phases.

## O. Phase 3 Status

- Files changed: `services/hub-api/src/main/java/lk/resq/localhub/service/FirmwarePersistenceRepository.java`, `services/hub-api/src/main/java/lk/resq/localhub/model/firmware/FirmwareCommandRequestRecord.java`, `services/hub-api/src/main/java/lk/resq/localhub/model/firmware/FirmwareEventRecord.java`, `services/hub-api/src/main/java/lk/resq/localhub/model/firmware/FirmwareCalibrationResultRecord.java`, `services/hub-api/src/main/java/lk/resq/localhub/model/firmware/FirmwareDebugSnapshotRecord.java`, plus additive wiring in `MqttCommandPublisherService` and `MqttSubscriberService` and focused backend tests.
- Tables added: `firmware_command_requests`, `firmware_events`, `firmware_calibration_results`, and `firmware_debug_snapshots` using `CREATE TABLE IF NOT EXISTS` so existing local installs remain compatible.
- Repositories/services added: `FirmwarePersistenceRepository` now owns the SQLite schema, insert/update helpers, and query helpers such as `findCommandByRequestId`, `findRecentCommands`, `findRecentEvents`, `findLatestCalibrationResult`, and `findDebugSnapshots`.
- Command tracking behavior: canonical command publishes create a `PENDING` row before publish, transition to `PUBLISHED` on success, and transition to `FAILED` on publish failure; command replies update the matching row when `reply_id` or `request_id` is present.
- Event persistence behavior: canonical firmware events are persisted for `events`, `events/calibration`, and `events/error`; calibration packets also land in `firmware_calibration_results`; debug packets land in `firmware_debug_snapshots`.
- Deferred item: firmware state history and diagnostic HTTP endpoints were intentionally not added in this phase to keep the change additive and localized; frontend and Tauri work remains Phase 4 and later.

## P. Phase 4 Status

- Files changed: `apps/localhub-desktop/src/lib/firmwareLiveNormalizer.ts`, `apps/localhub-desktop/src/lib/liveClientTypes.ts`, `apps/localhub-desktop/src/lib/mqttLiveClient.ts`, `apps/localhub-desktop/src/lib/liveClient.ts`, `apps/localhub-desktop/src/hooks/useLiveSession.ts`, `apps/localhub-desktop/src/components/LiveMetricsPanel.tsx`, `apps/localhub-desktop/src/pages/InstructorDashboard.tsx`, `apps/localhub-desktop/src/pages/TraineeDashboard.tsx`, and browser-facing live API types.
- Frontend normalization now accepts firmware snake_case fields including `session_id`, `session_active`, `last_error_id`, `depth_progress`, `depth_ok`, `rate_cpm`, compression counters, recoil counters, `pause_s`, `hand_placement`, `pressure_balance_pct`, event IDs, reason/action/progress IDs, and `ts_ms`.
- MQTT live client now subscribes to canonical `resq/{deviceId}/status`, `heartbeat`, `telemetry`, `debug`, `events`, `events/calibration`, and `events/error` topics while keeping legacy `resq/manikins/{deviceId}/status`, `heartbeat`, `telemetry`, `events`, and `live`.
- SSE and polling fallbacks continue to use the shared live update normalizer, so backend-forwarded firmware-style payloads with device IDs are tolerated without changing dashboard page logic.
- Dashboard compatibility was kept minimal: existing status/metric panels can show `firmwareState`, use firmware `rateCpm` and compression counts through the live metric model, and display `depthProgress` as a percentage when millimeter depth is not present.
- Production build note: `tsconfig.json` now excludes `*.test.ts(x)` from `pnpm build`; frontend test tooling remains separate from the production build path and was not repaired as part of this phase.
- Deferred item: full calibration/readiness UI, diagnostic endpoints, Tauri provisioning changes, and backend schema changes remain out of scope for Phase 4.

## Q. Phase 5 Status

- Backend DTOs and endpoints added for local firmware calibration/readiness: `POST /api/firmware/devices/{deviceId}/calibration/start`, `POST /api/firmware/devices/{deviceId}/calibration/cancel`, `GET /api/firmware/devices/{deviceId}/calibration/latest`, and `GET /api/firmware/devices/{deviceId}/readiness`.
- `FirmwareCalibrationService` now publishes calibration start/cancel through the existing MQTT command publisher and maps persisted `firmware_calibration_results` plus current registry state into `FirmwareReadinessResponse`.
- Readiness mapping: `READY_FOR_SESSION` is ready; `PASS` is ready when the device is not in `CALIBRATING`, `CALIBRATION_FAIL`, `ERROR`, or `SESSION_ACTIVE`; `FAIL`, `CANCELLED`, `CALIBRATING`, and `ERROR` are not ready.
- Session start now has a conservative backend readiness gate for known firmware devices only. Legacy devices with no firmware state or calibration result remain compatible.
- Instructor dashboard now shows a small readiness/calibration block per live device and can request calibration start/cancel using local backend endpoints. Start Session is disabled for known not-ready firmware devices.
- Tests added for calibration service behavior, controller command responses, readiness mapping, and session-start blocking for a known not-ready firmware device.
- Deferred item: calibration profile management UI, richer diagnostic command/event/debug endpoints, Tauri provisioning cleanup, and any cloud routing remain out of scope for this phase.
- Next phase recommendation: wire provisioning/orchestration around the firmware lifecycle only after validating the Phase 5 endpoints with real device calibration events.

## R. Phase 6 Status

- Local firmware simulator added at `scripts/firmware-simulator/firmware-simulator.js`; it is a Windows-friendly Node script that reuses the existing desktop `mqtt` dependency and exposes `--help`.
- Simulator publishes canonical firmware topics only: retained `status`, periodic `heartbeat`, session `telemetry`, `debug`, `events`, `events/calibration`, and `events/error`.
- Simulator subscribes to `resq/{deviceId}/cmd/#` and handles calibration start/cancel, session start/stop, debug, system retry/reset, calibration failure mode, firmware ERROR mode, and optional session interruption.
- Command replies include `reply_id` copied from incoming `request_id`, `event_id`, firmware `state`, `reason_id`, `action_id`, and `ts_ms` so Phase 3 persistence and Phase 5 readiness endpoints can be exercised end to end.
- Smoke-test guide added at `docs/local-firmware-simulator-smoke-test.md` with Mosquitto/backend/UI startup steps, simulator commands, expected MQTT topics, dashboard behavior, and failure simulation flows.
- No Tauri provisioning, cloud behavior, firmware contract, backend schema, or legacy MQTT compatibility changes were made in this phase.
- Next phase recommendation: run the documented smoke test with the backend and dashboard, then compare simulator traces against real ESP32 firmware traces before changing provisioning/orchestration.

## S. Phase 6.1 Hotfix Status

- Smoke testing found canonical `resq/{deviceId}/telemetry` packets were rejected because backend telemetry normalization still required `deviceId` in the JSON body.
- Fix applied: `MqttSubscriberService` now passes the MQTT topic-derived device ID into `TelemetryPayloadNormalizer`, and the normalizer accepts firmware telemetry without `device_id`/`deviceId` when that topic device ID is available.
- Safety behavior preserved: if a telemetry payload includes a device ID that conflicts with the topic device ID, normalization rejects it with a clear mismatch reason rather than storing data under the wrong device.
- Existing legacy telemetry compatibility remains: legacy `resq/manikins/{deviceId}/telemetry` topics and older payload fields such as `current_delta`, `currentDelta`, `depthMm`, `rateCpm`, `pauseS`, and `feedback` are still supported.
- Smoke test should be rerun to confirm the backend no longer logs `payload deviceId is missing` for canonical telemetry and the active session `sampleCount` increases.

## T. Phase 6.2 Hotfix Status

- Follow-up smoke testing showed accepted firmware telemetry was still logging `used firmware depth_progress/current_delta as fallback depthMm`, which made ratio values such as `0.78` appear as physical millimeters.
- Fix applied: backend `LiveMetricPayload` now carries nullable `depthProgress` separately from nullable `depthMm`; `depth_progress`/`depthProgress` no longer populate `depthMm`.
- Legacy compatibility remains: explicit `depth_mm`/`depthMm` still populate physical depth, and legacy `current_delta`/`currentDelta` remains a fallback for older non-firmware telemetry.
- Active session accumulation still counts telemetry samples with only `depthProgress`, keeps rate/recoil/pause/flag data, and avoids calculating millimeter averages from progress-only packets.
- Smoke test should be rerun to confirm telemetry remains accepted, `sampleCount` increases, and no warning claims `depth_progress` is being used as `depthMm`.

## U. Phase 7 Status

- Backend local firmware onboarding endpoints added: `POST /api/devices/register` for tolerant firmware registration and `GET /api/hub/service-info` for LAN-friendly backend/MQTT service details.
- Registration response returns `ok`, `device_id`, `mqtt_host`, and `mqtt_port`; it does not require or return `manikin_id`, cloud auth, JWTs, MQTT credentials, or provisioning secrets.
- Service info advertises `backend_base_url`, `mqtt_host`, `mqtt_port`, `dashboard_url`, and `local_ip`, with configurable advertised hosts and localhost/LAN fallback behavior.
- Desktop provisioning QR payload was cleaned up to default to only `wifi_ssid`, `wifi_password`, and `backend_base_url`; MQTT broker details are shown as service information and fetched by firmware after registration.
- Instructor dashboard keeps the existing layout but now shows LocalHub service info, backend URL, Wi-Fi inputs, QR, and copyable provisioning JSON for the new firmware onboarding flow.
- Simulator smoke-test documentation now distinguishes real firmware onboarding from the simulator's direct MQTT connection.
- Deferred item: persisted device identity management, per-device MQTT credentials, richer broker health detection, and any cloud routing remain out of scope for Phase 7.

## V. Phase 8 Status

- Real-device smoke-test guide added: [docs/real-esp32-localhub-integration-smoke-test.md](real-esp32-localhub-integration-smoke-test.md) documents the full ESP32 provisioning, registration, calibration, session, and debug trace workflow.
- MQTT trace helper added: `scripts/firmware-simulator/watch-real-firmware-mqtt.ps1` subscribes to the canonical firmware topics used by real ESP32 hardware so trace output can be compared against the simulator.
- Service-info helper added: `scripts/check-localhub-service-info.ps1` checks `/api/hub/service-info` and `/api/devices/register` so LAN host, MQTT host, and registration payload shape can be verified before hardware testing.
- Simulator comparison points: topic shape, calibration event IDs `4000`/`4001`/`4002`, session event IDs `2000`/`2001`, telemetry arrival timing, and debug snapshot handling should match the simulator unless a real mismatch is documented.
- Deferred item: no cloud routing, per-device credentials, provisioning redesign, or dashboard redesign was introduced in Phase 8; any mismatch fixes should remain small and compatibility-safe.

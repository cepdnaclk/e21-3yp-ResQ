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
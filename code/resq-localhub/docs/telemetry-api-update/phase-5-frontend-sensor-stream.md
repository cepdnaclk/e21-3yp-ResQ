# Phase 5 Frontend Sensor Stream

## UI Location

Manual sensor stream controls live in the existing `FirmwareDiagnosticsPanel` under the section title `Live Sensor Stream`. This keeps diagnostics separate from CPR session live metrics and trainee session views.

## REST Calls

The frontend calls the Phase 4 backend routes:

- `POST /api/devices/{deviceId}/telemetry/start` with `{ "interval_ms": intervalMs }`
- `POST /api/devices/{deviceId}/telemetry/stop` with no body
- `GET /api/devices/{deviceId}/telemetry/latest`

The START/STOP client maps backend snake_case response fields into a focused command response and never sends session identifiers, trainee identifiers, profile identifiers, or compression fields.

## SSE Behavior

The panel uses the existing fetch-based SSE abstraction and connects to:

`GET /api/stream/devices/{deviceId}/sensor-stream`

Only named `sensor-stream` events are parsed. Each payload is validated before display: device id must match, `telemetry_mode` must be `SENSOR_STREAM`, numeric fields must be finite, booleans must be booleans, and the saturation mask must only contain pressure channel bits 0-2.

The client is stopped on unmount and recreated on device changes. Old-device messages are ignored by the parser and component guard.

## Stream UI States

The frontend uses:

- `IDLE`
- `STARTING`
- `RUNNING`
- `STOPPING`
- `STALE`
- `RECONNECTING`
- `ERROR`

HTTP command publication does not mean the stream is running. After START is accepted, the UI shows the command as published and the observed stream as waiting until the first valid packet arrives.

## Interval Validation

The interval input defaults to 200 ms and accepts whole numbers from 100 to 1000 ms. Invalid values are shown inline and disable Start. The frontend does not silently clamp values; backend validation remains authoritative.

## Validity Rendering

Each pressure channel renders independently:

- saturation bit set: `Saturated`
- channel validity false: `Unavailable`
- otherwise: numeric kPa

Aggregate `pressure_kpa_valid` is shown as valid/degraded context without hiding individually valid channels.

Hall data renders `hall_mm` and `hall_progress` only when `hall_mm_valid` is true. Invalid hall data displays `Unavailable` and does not present 0 mm as a real reading.

## Timestamps And Staleness

The UI displays firmware `ts_ms` as device-relative diagnostic time, backend `receivedAt` as wall-clock time, and frontend packet age from local receipt. Stale threshold is `max(3 * intervalMs, 1500 ms)`.

## Command Status Versus Observed Status

Command status is labeled separately from observed stream state. The current backend exposes command publication and later command reply records through the diagnostics bundle, but this Phase 5 panel does not yet subscribe to a command-status stream.

## Direct MQTT Isolation

The direct MQTT fallback and shared live telemetry normalizer reject payloads carrying `telemetry_mode` before building `LiveMetricPayload`. This keeps `SENSOR_STREAM` and unknown telemetry modes out of CPR session UI state, graphs, trainee live views, and completed session summaries.

## RBAC Behavior

The panel is mounted in instructor/admin diagnostics surfaces, and backend routes remain the security boundary. Trainee live/session views do not render these controls.

## Tests

Added targeted Vitest coverage for:

- exact START/STOP API paths and bodies
- interval validation boundaries
- latest snapshot 404 handling
- malformed snapshot rejection
- HTTP-published versus stream-running UI state
- first SSE packet transition to running
- per-channel pressure validity
- saturation rendering
- valid zero versus invalid zero
- hall valid/invalid rendering
- stale and reconnect transitions
- stop behavior without session endpoints
- device-change cleanup
- direct MQTT/session normalizer SENSOR_STREAM isolation

## Known Limitations

Firmware ACK/NACK is not shown live in the panel unless the diagnostics bundle is refreshed. A future phase can merge command reply status into this panel through an existing command/event stream or a small polling hook.

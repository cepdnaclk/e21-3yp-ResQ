# Phase 3 Manual Sensor Stream

## Command Contract

Manual diagnostics streaming is controlled by MQTT command topic:

```text
resq/{device_id}/cmd/telemetry
```

The command payload requires a non-empty `request_id` and an `action`.
Accepted actions are `START` and `STOP`, following the firmware's existing
command comparison convention that also accepts lowercase forms.

`START` requires `interval_ms`. Invalid intervals are rejected and are not
clamped. `STOP` ignores `interval_ms` if present.

Replies use the existing command-result event convention and set:

```json
{"reply_id":"<request_id>","status":"ACK|NACK"}
```

## Interval Policy

- Minimum: `100 ms`
- Default constant: `200 ms`
- Maximum: `1000 ms`

The default is kept as a constant for compatibility, but `START` requires an
explicit interval in this phase.

## Idempotency

`START` while the manual stream is already active does not create a second
task. A same-interval request ACKs as already effective; a different valid
interval updates the stored interval used by the existing task.

`STOP` is idempotent. If the manual stream is already stopped, the command ACKs
without touching CPR session telemetry, CPR metrics, heartbeat, or status
publishing.

## Allowed States

Manual `START` is accepted only from:

- `PAIRED_IDLE`
- `READY_FOR_SESSION`
- `CALIBRATION_FAIL`

`START` is rejected from `CALIBRATING`, `SESSION_ACTIVE`, `ERROR`, reset/turnoff
flows, provisioning/connection states, and any state that does not route
`cmd/telemetry` with `allow_start=true`.

`STOP` remains safe in rejected states because it only targets the manual stream.

## Sensor Ownership

The `sensor_owner` component provides a mutex-protected lifecycle owner:

```c
typedef enum {
    SENSOR_OWNER_NONE = 0,
    SENSOR_OWNER_MANUAL_STREAM,
    SENSOR_OWNER_CALIBRATION,
    SENSOR_OWNER_SESSION
} sensor_owner_t;
```

Manual streaming acquires `SENSOR_OWNER_MANUAL_STREAM`. Calibration acquisition
acquires `SENSOR_OWNER_CALIBRATION`. Active CPR sensor acquisition acquires
`SENSOR_OWNER_SESSION`.

Only the current owner can release ownership. A failed acquire does not overwrite
the existing owner. Repeated release is safe and leaves the owner unchanged if
called by a non-owner.

Ownership represents the acquisition lifecycle; the mutex is not held while
reading sensors, building JSON, or publishing MQTT.

## Task Lifecycle

The manual stream task starts cooperatively after manual ownership is acquired.
Per interval it:

1. Reads pressure once using `hx710_read_3_shared_sck`.
2. Reads Hall once using `hall_sensor_read_raw`.
3. Builds one `sensor_raw_sample_t`.
4. Calls `sensor_conversion_convert` once.
5. Publishes one diagnostics payload to `resq/{device_id}/telemetry`.
6. Waits using `vTaskDelayUntil`.

The task exits on STOP or MQTT disconnect, clears task state, releases manual
ownership, signals stopped, and deletes itself.

## Payload

Manual stream payloads publish on:

```text
resq/{device_id}/telemetry
```

Required discriminator:

```json
"telemetry_mode": "SENSOR_STREAM"
```

Fields:

- `device_id`
- `telemetry_mode`
- `state`
- `pressure_0_kpa`
- `pressure_0_kpa_valid`
- `pressure_1_kpa`
- `pressure_1_kpa_valid`
- `pressure_2_kpa`
- `pressure_2_kpa_valid`
- `pressure_kpa_valid`
- `hall_mm`
- `hall_progress`
- `hall_mm_valid`
- `pressure_saturation_mask`
- `interval_ms`
- `ts_ms`

The payload intentionally omits session scoring fields such as `session_id`,
compression counts, rate, recoil counts, and score fields.

Invalid converted numeric values are emitted as finite `0.000` values with
validity flags set to `false`.

## Automatic Stop Before Acquisition

Before calibration start and session start, the idle/calibration-fail command
loops request manual stream shutdown and wait for confirmed task exit. If the
stream does not stop within the configured timeout, calibration/session start is
not attempted and the command is NACKed.

## Debug Interaction

Idle direct debug snapshots do not read sensors while manual streaming owns the
hardware. In this phase they reject with the existing debug NACK path instead of
reusing the latest stream sample.

Active-session debug remains unchanged and uses `SESSION_METRICS` only.

## Connectivity And Cleanup

Manual streaming stops and releases ownership on:

- manual `STOP`
- MQTT disconnect detected by the stream task
- idle/calibration-fail Wi-Fi or MQTT loss paths
- transition into `ERROR`
- reset and turn-off runtime cleanup through `telemetry_publisher_stop_all`
- session/calibration start preflight

The stream is not automatically restarted after reconnect.

## HX710 Validity Limitation

The current pressure driver returns one aggregate status for
`hx710_read_3_shared_sck`. Manual stream therefore maps aggregate read success
to all pressure read-valid entries and keeps per-channel saturation validity
independent. This phase does not redesign the HX710 driver to return independent
per-channel acquisition validity.

## Test Coverage

Added Unity coverage for:

- sensor ownership acquire/release and competing owner rejection
- command validation for missing IDs/actions and invalid intervals
- valid START and STOP parsing
- SENSOR_STREAM payload fields
- absence of session scoring fields in SENSOR_STREAM payloads
- saturated channel validity behavior
- finite zero output for invalid converted values

Hardware/serial tests still require a connected target and were not run as part
of this phase.

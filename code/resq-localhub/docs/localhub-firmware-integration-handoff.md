# ResQ LocalHub Firmware Integration Handoff

This document is the final local handoff for the firmware migration work completed in this repository. It summarizes the current architecture, the local firmware contract, the demo and diagnostics workflow, and the remaining deferred items.

## Current Local Architecture

The local stack is intentionally offline-first and demo-focused:

- `services/hub-api` runs the Spring Boot backend, owns local authentication, session lifecycle, persistence, diagnostics, and MQTT boundary handling.
- `apps/localhub-desktop` provides the Windows-friendly React/Vite/Tauri dashboard and local orchestration entry points.
- `scripts/firmware-simulator/firmware-simulator.js` simulates ESP32 firmware over MQTT and is the primary validation tool when real hardware is unavailable.
- `infra/mosquitto` hosts the local MQTT broker configuration used by the backend, desktop app, and simulator.
- `docs/*` contains the runbooks, smoke tests, and migration audit for the local workflow.

Legacy compatibility is still intentionally present. The backend still accepts legacy `resq/manikins/...` topics, and some demo utilities still default to `M01` so the local flows remain easy to run. Those are compatibility remnants, not product scope changes.

## Firmware Provisioning Flow

Real firmware should still provision in two stages:

1. The phone must first connect to the ESP setup Wi-Fi (for example `ResQ Setup`) so `http://192.168.4.1/` is reachable.
2. The LocalHub QR opens the firmware portal root URL with query parameters:

	`http://192.168.4.1/?wifi_ssid=<encoded>&wifi_pass=<encoded>&backend_base_url=<encoded>&auto=1`

3. The firmware receives canonical `wifi_ssid`, `wifi_pass`, and `backend_base_url` values from the provisioning URL query. It temporarily accepts `ssid`; `wifi_password` or `password`; and `backend_url` or `hub_url` as compatibility aliases.
4. If firmware supports `auto=1`, it can save and connect automatically; otherwise the user presses `Save Configuration` manually in the portal.
5. The firmware connects to Wi-Fi and calls `POST /api/devices/register`.
6. The backend returns the runtime connection details the device needs for MQTT.

The backend registration endpoint is tolerant and local-only. It returns:

- `ok`
- `device_id`
- `mqtt_host`
- `mqtt_port`

The QR generators use `URLSearchParams`, including an explicit empty
`wifi_pass` for open networks, and preserve password whitespace and special
characters. The firmware field remains masked and editable. Firmware
registration sends the existing `device_mac` and `firmware_version` fields;
the backend accepts `device_mac` as an alias of its canonical `mac` request
property.

The service-info endpoint returns the LAN-oriented setup information used by the desktop and demo scripts:

- `backend_base_url`
- `mqtt_host`
- `mqtt_port`
- `dashboard_url`
- `local_ip`

## Calibration Profiles

Calibration settings are now stored locally in SQLite and can be edited from the instructor dashboard without touching the firmware contract.

- The first launch seeds an `adult-basic` default profile with the existing adult CPR calibration values.
- The dashboard Calibration Settings panel lets an instructor choose a live device, edit profile values, save a new or existing profile, set a profile as default, and deactivate non-default profiles.
- Run Calibration uses the selected saved profile, or the saved default profile when no custom profile is selected.
- The firmware still receives the same MQTT command fields: `request_id`, `hall_delta`, `ref_pressure`, `bladder_1_pressure`, `bladder_2_pressure`, and `issued_at_ms`.

## MQTT Topic Contract

Canonical firmware topics remain under `resq/{deviceId}/...`:

- `status`
- `heartbeat`
- `telemetry`
- `debug`
- `events`
- `events/calibration`
- `events/error`
- `cmd/#`

The backend and simulator also continue to accept legacy `resq/manikins/{deviceId}/...` topics for compatibility.

## Command Request/Reply Rule

Command requests should carry a `request_id` and any firmware response should echo that identifier back as `reply_id`.

This applies to calibration, session control, debug, and maintenance-style commands in the local simulator flow. The command reply is what ties MQTT publish, persistence, diagnostics, and UI traces together.

## Telemetry Payload Rules

Telemetry is normalized at the backend boundary and must remain consistent with the following rules:

- `depthMm` is physical depth in millimeters.
- `depthProgress` is a separate progress signal and must not be coerced into millimeters.
- If telemetry contains only `depthProgress`, the session can still be recorded and reviewed.
- Legacy aliases such as `current_delta` and `currentDelta` remain supported for compatibility.
- The backend continues to accept legacy `feedback`-style payloads where needed for older tooling.

## Calibration Flow

Calibration remains the first readiness gate for the demo workflow:

1. The instructor opens the Calibration Settings panel and chooses a live device.
2. The instructor selects the `Adult Basic` default profile or edits/saves another local profile.
3. The instructor clicks `Run Calibration`.
4. The backend publishes the canonical calibration start command using the saved profile values.
5. The simulator returns `event_id` `4000`, `4001`, and `4002`.
6. The readiness block updates to the final calibrated state when the result is `PASS`.

## Session Flow

1. The instructor selects a trainee mode.
2. The instructor clicks `Start Session`.
3. The backend publishes the canonical session start command.
4. The simulator returns `event_id` `2000` and begins telemetry.
5. The instructor clicks `End Session`.
6. The simulator returns `event_id` `2001` and stops telemetry.
7. The completed session is saved locally and appears in the Local Session Review panel.

## Diagnostics Usage

The instructor dashboard includes a Firmware Diagnostics panel for each live device card. It is used to:

- refresh readiness
- inspect recent commands
- inspect recent events
- inspect recent debug snapshots
- request a fresh debug snapshot

The diagnostics panel is intentionally local-only and is meant for demo and troubleshooting visibility, not cloud reporting.

## Simulator Usage

The simulator is the primary validation tool while real hardware is unavailable.

Useful commands:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -CalibrationMode fail
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -SimulateError
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -SimulateInterrupted
```

The simulator publishes visible log output and should remain in its own terminal window during debugging.

## Demo Launcher Usage

Use the safe launcher to open broker, backend, desktop, simulator, watcher, and service-info windows in separate visible PowerShell sessions:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-local-demo.ps1
```

Dry-run-style validation with all skip switches:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-local-demo.ps1 -SkipBackend -SkipDesktop -SkipBroker -SkipSimulator -SkipWatcher
```

Each service remains visible in its own window so you can inspect logs directly instead of relying on a hidden supervisor.

## Real ESP Integration Checklist

Before switching from simulator validation to real hardware, verify:

1. The provisioning QR only contains `wifi_ssid`, `wifi_pass`, and `backend_base_url`.
2. The provisioning QR opens the firmware portal root URL (`http://192.168.4.1/`) with URL-encoded query parameters.
3. The phone is connected to ESP setup Wi-Fi before scanning.
4. `auto=1` is supported by firmware for automatic save when available; manual Save remains valid if not.
5. The backend registration endpoint returns `ok`, `device_id`, `mqtt_host`, and `mqtt_port`.
6. The device publishes canonical `resq/{deviceId}/...` topics.
7. Calibration produces `4000`, `4001`, and `4002` in order.
8. Session start produces `2000` and session stop produces `2001`.
9. Telemetry binds the device ID from the MQTT topic.
10. `depthProgress` remains separate from `depthMm`.
11. The diagnostics panel and session review/export flows still work after a real trace.

## Known Limitations and Deferred Items

- Real ESP hardware validation remains deferred until hardware is available.
- Real sensor calibration tuning remains deferred.
- Production installer hardening remains deferred.
- Cloud sync and cloud deployment remain out of scope.
- Per-device MQTT credentials and broader security hardening remain deferred.
- Legacy MQTT compatibility remains intentionally supported so older traces and tools do not break during the handoff period.

## Final Checklist

Ready:

- Backend tests pass
- Desktop build passes
- Simulator works
- Demo launcher works
- Registration endpoint works
- Service-info endpoint works
- Diagnostics available
- Session review/export available

Deferred:

- Real ESP hardware validation
- Real sensor calibration tuning
- Production installer hardening
- Cloud sync/deployment
- Per-device MQTT credentials/security hardening

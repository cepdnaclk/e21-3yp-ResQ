# Local Firmware Simulator Smoke Test

This smoke test validates the local ESP32 firmware contract path without real hardware:

`firmware simulator -> Mosquitto -> hub-api -> desktop/browser dashboard`

The simulator only uses canonical MQTT topics under `resq/{deviceId}/...`. Legacy topic support remains in the backend, but this test is intended to exercise the new firmware contract.

For physical hardware, use [docs/real-esp32-localhub-integration-smoke-test.md](real-esp32-localhub-integration-smoke-test.md). That document covers the real ESP32 provisioning flow, registration request, and trace comparison against this simulator workflow.

## Real Firmware Onboarding Shape

Phase 7 narrows the real firmware provisioning QR to only:

```json
{
  "wifi_ssid": "training-wifi",
  "wifi_pass": "password",
  "backend_base_url": "http://192.168.8.187:18080"
}
```

Real firmware should use `backend_base_url` to call `POST /api/devices/register`, then use the returned `device_id`, `mqtt_host`, and `mqtt_port` to connect to MQTT and publish `resq/{deviceId}/status` plus `resq/{deviceId}/heartbeat`.

The simulator still connects directly to MQTT because it is a local validation tool, not the ESP32 provisioning flow. Real firmware should register first and only then connect to MQTT.

## Prerequisites

- Node.js is available on `PATH`.
- Local dependencies for `apps/localhub-desktop` are installed so the simulator can reuse the existing `mqtt` package.
- Mosquitto is installed and can use `infra/mosquitto/mosquitto.dev.conf`.
- Hub API and the desktop/browser UI can run locally.

## Start Local Services

From the repository root:

```powershell
mosquitto -c .\infra\mosquitto\mosquitto.dev.conf
```

In another terminal:

```powershell
cd services\hub-api
.\mvnw.cmd spring-boot:run
```

In another terminal for the desktop/browser UI:

```powershell
cd apps\localhub-desktop
pnpm.cmd dev
```

Open the instructor dashboard and sign in as an instructor/admin.

## Run The Simulator

From the repository root:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01
```

Useful variants:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --calibration-mode fail
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --simulate-error
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --simulate-interrupted
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --telemetry-interval-ms 500
```

You can also configure it with environment variables:

```powershell
$env:DEVICE_ID="M01"
$env:MQTT_URL="mqtt://127.0.0.1:1883"
$env:CALIBRATION_MODE="pass"
node .\scripts\firmware-simulator\firmware-simulator.js
```

## Expected MQTT Topics

The simulator publishes:

- `resq/M01/status` retained
- `resq/M01/heartbeat`
- `resq/M01/telemetry`
- `resq/M01/debug`
- `resq/M01/events`
- `resq/M01/events/calibration`
- `resq/M01/events/error`

The simulator subscribes to:

- `resq/M01/cmd/#`

## Calibration Flow

In the instructor dashboard, click `Run Calibration` for `M01`.

Expected simulator behavior:

- Receives `resq/M01/cmd/calibration/start`
- Publishes `event_id: 4000` ACK to `resq/M01/events/calibration`
- Publishes several `event_id: 4001` progress packets
- Publishes `event_id: 4002` final result
- Publishes retained status `READY_FOR_SESSION` when `--calibration-mode pass`
- Publishes retained status `CALIBRATION_FAIL` when `--calibration-mode fail`

Expected dashboard behavior:

- Readiness block changes from unknown/not ready to ready after a PASS.
- `Start Session` is enabled for a ready device.
- `Start Session` remains disabled after FAIL.

Click `Cancel Calibration` while calibration is running.

Expected simulator behavior:

- Receives `resq/M01/cmd/calibration/cancel`
- Publishes `event_id: 4002` with `result: CANCELLED`
- Publishes retained status `PAIRED_IDLE`

## Session Flow

After a passing calibration:

1. Select a trainee mode.
2. Click `Start Session`.

Expected simulator behavior:

- Receives `resq/M01/cmd/session/start`
- Publishes `event_id: 2000` to `resq/M01/events`
- Publishes retained status `SESSION_ACTIVE`
- Starts telemetry on `resq/M01/telemetry`

Expected dashboard behavior:

- Instructor live metrics update.
- Trainee dashboard receives live rate, compression count, flags, and depth percentage.

After the session ends, the instructor dashboard should show the completed session in the Local Session Review panel. Use that panel to inspect the summary, confirm the progress-aware depth values, and export the session as JSON or CSV for demo notes.

Click `End Session`.

Expected simulator behavior:

- Receives `resq/M01/cmd/session/stop`
- Stops telemetry
- Publishes `event_id: 2001` to `resq/M01/events`
- Publishes retained status `READY_FOR_SESSION`

## Debug Flow

Use the backend command publisher or an MQTT client to publish a debug command:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -t resq/M01/cmd/debug -m '{\"request_id\":\"req-100-0001\",\"issued_at_ms\":123456}'
```

Expected simulator behavior:

- Publishes a raw debug snapshot to `resq/M01/debug`
- Publishes `event_id: 1002` ACK to `resq/M01/events`

Expected backend behavior:

- Debug snapshots are persisted in `firmware_debug_snapshots`.
- Firmware events are persisted in `firmware_events`.

The instructor dashboard now includes a minimal Firmware Diagnostics panel for each live device card. Use it to:

- refresh readiness, command history, event history, and debug snapshot history
- request a debug snapshot without leaving the dashboard
- verify that the latest command, event, and debug rows show up after the simulator replies

When the panel is opened, the latest diagnostics payload should show the same command/event sequence that the simulator emitted on MQTT.

## Failure Simulation

Calibration failure:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --calibration-mode fail
```

Firmware error:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --simulate-error
```

Session interruption:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --simulate-interrupted
```

Expected dashboard behavior:

- Not-ready firmware states keep `Start Session` disabled when readiness is known.
- ERROR state appears in the readiness/status display.
- Interrupted session emits `event_id: 2002` and stops telemetry.

## Quick Command Check

The help command does not require a running broker:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --help
```

For a short connection check with a running broker:

```powershell
node .\scripts\firmware-simulator\firmware-simulator.js --device-id M01 --exit-after-ms 3000
```

Expected output includes a connection line, subscription line, retained status publish, and heartbeat publish.

## Deferred

This simulator does not replace hardware validation. It intentionally does not start Tauri, provision devices, or test cloud flows. Use it as the local contract smoke test before moving to real ESP32 firmware.

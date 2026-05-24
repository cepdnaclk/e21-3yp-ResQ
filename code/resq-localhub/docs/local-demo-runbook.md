# Local Demo Runbook

This runbook is the shortest Windows-first path for demonstrating ResQ LocalHub locally with the firmware simulator. It keeps the current MQTT contract, does not require ESP hardware, and uses the same backend, desktop, and review flow that Phase 11 hardens.

## Prerequisites

- Windows PowerShell 5.1 or PowerShell 7.
- Node.js on `PATH`.
- Java 17 and the Maven wrapper in `services/hub-api`.
- `pnpm` available for `apps/localhub-desktop`.
- Mosquitto installed and runnable with `infra/mosquitto/mosquitto.dev.conf`.

## Required Terminals

Keep these terminals open:

1. Mosquitto broker.
2. Hub API backend.
3. Desktop app or browser dashboard.
4. Firmware simulator.
5. Optional MQTT trace helper.
6. Optional service-info preflight helper.

## Ports And URLs

- Backend API: `http://localhost:18080`
- Backend health: `http://localhost:18080/api/hub/health`
- Backend service-info: `http://localhost:18080/api/hub/service-info`
- Desktop app: `http://localhost:1420`
- MQTT broker: `127.0.0.1:1883`
- MQTT WebSocket listener: `127.0.0.1:9001` when the desktop/broker config enables it

## Start Commands

From the repository root, start Mosquitto:

```powershell
mosquitto -c .\infra\mosquitto\mosquitto.dev.conf
```

Start the backend in another terminal:

```powershell
cd services\hub-api
.\mvnw.cmd spring-boot:run
```

Start the desktop UI in another terminal:

```powershell
cd apps\localhub-desktop
pnpm.cmd dev
```

Run the simulator in another terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01
```

Run the service-info preflight helper in another terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-localhub-service-info.ps1
```

Run the optional MQTT trace helper in another terminal:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\demo-mqtt-watch.ps1
```

## Demo Launcher

If you want the demo services opened in separate visible PowerShell windows, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-local-demo.ps1
```

The launcher keeps every service window visible so you can watch broker, backend, desktop, simulator, watcher, and preflight logs during debugging.

To validate the launcher without starting anything, use the dry-run style skip command:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-local-demo.ps1 -SkipBroker -SkipBackend -SkipDesktop -SkipSimulator -SkipWatcher
```

If the launcher fails or you want to start services manually, fall back to the individual commands in the sections above. The manual path is the same one the launcher uses, just split across separate terminals.

## Expected MQTT Topics

The simulator and backend should use canonical topics under `resq/{deviceId}/...`.

Expected published topics:

- `resq/M01/status`
- `resq/M01/heartbeat`
- `resq/M01/telemetry`
- `resq/M01/debug`
- `resq/M01/events`
- `resq/M01/events/calibration`
- `resq/M01/events/error`
- `resq/M01/cmd/#`

Legacy `resq/manikins/{deviceId}/...` topics should still work for compatibility, but the demo flow should prefer the canonical namespace.

## Calibration Flow

1. Open the instructor dashboard.
2. Open the `Calibration Settings` panel and confirm the `Adult Basic` default profile is present.
3. Select the live manikin you want to test.
4. Edit any calibration values you want to keep locally, then click `Save Profile`.
5. Click `Set Default` if you want the saved profile to become the fallback profile for later runs.
6. Click `Run Calibration`.
7. Watch the simulator publish ACK, progress, and final calibration result events.
8. Confirm the readiness badge changes to ready when calibration passes.

Expected simulator wrapper command for calibration failure testing:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -CalibrationMode fail
```

## Session Flow

1. Select a trainee mode.
2. Click `Start Session`.
3. Confirm live metrics update in the dashboard.
4. End the session.
5. Confirm the simulator stops telemetry and publishes the session stop event.

Optional interruption test:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -SimulateInterrupted
```

## Diagnostics Flow

1. Open the Firmware Diagnostics panel on the instructor dashboard.
2. Refresh diagnostics.
3. Request a debug snapshot.
4. Confirm the recent command, event, and debug snapshot lists update after the simulator responds.

If you need a deliberate firmware error state for troubleshooting, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\start-firmware-simulator.ps1 -DeviceId M01 -SimulateError
```

## Session Review And Export Flow

1. End a session from the instructor dashboard.
2. Open the Local Session Review panel.
3. Confirm the completed session appears in the recent session list.
4. Inspect the summary fields, including sample count, compression totals, and progress-aware depth values.
5. Use the JSON and CSV export links to save the session for demo notes or evaluation review.

## Troubleshooting

- If the backend health check fails, confirm `services/hub-api` is running on port `18080`.
- If the broker check fails, confirm Mosquitto is listening on `1883` and that no other local broker is occupying the port.
- If the desktop UI cannot reach the API, verify the local IP and `dashboard_url` printed by `scripts/check-localhub-service-info.ps1`.
- If the simulator does not connect, confirm `node` is installed and the MQTT URL points at the correct broker host and port.
- If calibration buttons remain disabled, check that the target device is publishing readiness and that the browser is not using stale state from an older session.
- If exports fail, confirm you are signed in with an instructor or admin role.
- If the service-info helper prints a LAN IP that is not reachable from other machines, use the Tauri-hosted LAN override flow or run the dashboard locally on the same machine.
- If the launcher opens a window but the service exits immediately, keep that window visible and read the error directly instead of relaunching blindly.
- If you prefer manual startup, use the individual broker, backend, desktop, simulator, watcher, and service-info commands from this runbook and keep each terminal open for logs.

## Notes

This runbook is intentionally local-only. It does not add cloud routing, does not require real ESP hardware, and does not change the firmware MQTT contract.

The firmware simulator does not use the provisioning QR flow. Real firmware onboarding uses the ESP portal URL QR (default `http://192.168.4.1/` with `wifi_ssid`, `wifi_pass`, `backend_base_url`, and optional `auto=1`).

# Real ESP32 LocalHub Integration Smoke Test

This smoke test verifies that a physical ESP32 firmware image behaves like the local simulator while still using the real device onboarding path.

Use it after the simulator smoke test in [docs/local-firmware-simulator-smoke-test.md](local-firmware-simulator-smoke-test.md) passes.

## Workflow Goal

Confirm the real device flow end to end:

1. ESP boots into provisioning mode if not configured.
2. User scans the LocalHub QR.
3. The QR payload contains only `wifi_ssid`, `wifi_password`, and `backend_base_url`.
4. ESP connects to Wi-Fi.
5. ESP calls `POST /api/devices/register`.
6. Backend returns `ok`, `device_id`, `mqtt_host`, and `mqtt_port`.
7. ESP connects to MQTT.
8. ESP subscribes to `resq/{deviceId}/cmd/#`.
9. ESP publishes `resq/{deviceId}/status` and `resq/{deviceId}/heartbeat`.
10. Instructor runs calibration.
11. ESP receives `resq/{deviceId}/cmd/calibration/start`.
12. ESP publishes calibration events `4000`, `4001`, and `4002`.
13. Instructor starts a session.
14. ESP receives `resq/{deviceId}/cmd/session/start`.
15. ESP publishes `resq/{deviceId}/events` with `event_id: 2000` and publishes telemetry.
16. Instructor stops the session.
17. ESP publishes `resq/{deviceId}/events` with `event_id: 2001`.

## Required Terminals

Keep these terminals open while testing:

1. Mosquitto broker.
2. Hub API backend.
3. Desktop app or browser dashboard.
4. ESP serial monitor.
5. MQTT trace helper.
6. Optional service-info helper for preflight checks.

## Start Commands

From the repository root:

```powershell
mosquitto -c .\infra\mosquitto\mosquitto.dev.conf
```

In a second terminal:

```powershell
cd services\hub-api
.\mvnw.cmd spring-boot:run
```

In a third terminal:

```powershell
cd apps\localhub-desktop
pnpm.cmd dev
```

In a fourth terminal, open the ESP serial monitor with the command used by your firmware toolchain. Keep it running so you can capture the registration and MQTT connection logs.

In a fifth terminal, run the MQTT trace helper:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\firmware-simulator\watch-real-firmware-mqtt.ps1
```

## Preflight Checks

Run the service-info helper before connecting hardware:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\check-localhub-service-info.ps1
```

Expected service-info response fields:

```json
{
  "ok": true,
  "backend_base_url": "http://<lan-ip>:18080",
  "mqtt_host": "<lan-ip-or-host>",
  "mqtt_port": 1883,
  "dashboard_url": "http://localhost:1420",
  "local_ip": "<lan-ip>"
}
```

Expected registration request body keys:

```json
{
  "mac": "AA:BB:CC:DD:EE:FF",
  "chip_id": "ESP32-1234",
  "firmware_version": "1.0.0",
  "device_label": "Training Manikin"
}
```

Expected registration response keys:

```json
{
  "ok": true,
  "device_id": "M01",
  "mqtt_host": "192.168.8.187",
  "mqtt_port": 1883
}
```

## Expected QR Payload

The LocalHub QR should only encode:

```json
{
  "wifi_ssid": "training-wifi",
  "wifi_password": "password",
  "backend_base_url": "http://192.168.8.187:18080"
}
```

If any MQTT broker details or cloud settings appear in the QR payload, treat that as a Phase 7/8 regression and do not continue until it is removed.

## Expected MQTT Topics

The real device should publish or receive these topics:

- `resq/{deviceId}/status`
- `resq/{deviceId}/heartbeat`
- `resq/{deviceId}/telemetry`
- `resq/{deviceId}/debug`
- `resq/{deviceId}/events`
- `resq/{deviceId}/events/calibration`
- `resq/{deviceId}/events/error`
- `resq/{deviceId}/cmd/#`

Legacy `resq/manikins/{deviceId}/...` topics should still be accepted by the backend, but the real hardware workflow should use the canonical namespace above.

## Calibration Test Steps

1. Register the device through the provisioning flow.
2. Confirm the serial monitor shows the returned `device_id`, `mqtt_host`, and `mqtt_port`.
3. Open the instructor dashboard and select the device.
4. Start calibration.
5. Confirm the MQTT trace helper shows `resq/{deviceId}/cmd/calibration/start`.
6. Confirm the firmware publishes event IDs `4000`, `4001`, and `4002`.
7. Confirm the backend readiness block moves into the calibrated/ready state.

Expected trace alignment points:

- `4000` is the calibration ACK.
- `4001` is the calibration progress stream.
- `4002` is the final calibration result.

## Session Start/Stop Test Steps

1. Complete calibration successfully.
2. Start a session from the instructor dashboard.
3. Confirm the trace helper shows `resq/{deviceId}/cmd/session/start`.
4. Confirm the firmware publishes `resq/{deviceId}/events` with `event_id: 2000`.
5. Confirm telemetry starts on `resq/{deviceId}/telemetry`.
6. Stop the session.
7. Confirm the firmware publishes `resq/{deviceId}/events` with `event_id: 2001`.
8. Confirm telemetry stops and the dashboard returns to the idle state.

## Debug Command Test Steps

1. Publish a debug command to `resq/{deviceId}/cmd/debug`.
2. Confirm the firmware publishes a snapshot to `resq/{deviceId}/debug`.
3. Confirm the firmware publishes a debug ACK event to `resq/{deviceId}/events`.
4. Confirm the backend stores the debug snapshot and related event record.

## Trace Comparison Against Simulator

Use the simulator as the baseline and compare these points against the real ESP32 trace:

- Topic names and namespace shape.
- Calibration ACK/progress/result ordering.
- Session start and stop event IDs.
- Whether telemetry arrives immediately after `event_id: 2000`.
- Whether status, heartbeat, and telemetry carry the same device and session IDs as the simulator.
- Whether debug packets stay on `resq/{deviceId}/debug` and never leak into telemetry.

If the real trace differs from the simulator, document the exact packet and only apply a small compatibility fix if the mismatch is clearly local and safe.

## Failure Checklist

- `POST /api/devices/register` fails from the ESP serial log.
- The device receives a different MQTT host or port than `service-info` advertised.
- The broker trace shows a legacy-only topic instead of `resq/{deviceId}/...`.
- Calibration reaches `4000` but never reaches `4002`.
- Session start never produces `event_id: 2000`.
- Telemetry is published before the device subscribes to `cmd/#`.
- Debug commands are not persisted or the debug snapshot topic is missing.
- The dashboard shows firmware state as unknown after registration and status publication.

## Deferred Items

This phase does not add cloud routing, per-device credentials, provisioning redesign, or dashboard redesign. It only provides the trace workflow needed to verify the real firmware against the simulator.
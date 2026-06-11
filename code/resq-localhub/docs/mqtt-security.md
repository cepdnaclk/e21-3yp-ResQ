# MQTT Security Modes

Purpose
-------

ResQ uses MQTT in two different ways:

- Firmware and backend use MQTT-over-TCP for telemetry and command delivery.
- Browser dashboards use MQTT-over-WebSocket for display-only live data.

The backend remains the authority for session start/end, validation, scoring, storage, exports, RBAC, and future cloud sync. Browser MQTT clients must not publish anything.

Security modes
--------------

Development mode:

- Config: `infra/mosquitto/mosquitto.conf` or `infra/mosquitto/mosquitto.dev.conf`.
- Anonymous MQTT is allowed on:
  - TCP `1883`
  - WebSocket `9001`
- Intended for quick local development only.

Final/demo mode:

- Config: `infra/mosquitto/mosquitto.final-demo.conf`.
- Anonymous MQTT is disabled.
- Password file is local-only: `infra/mosquitto/passwords`.
- ACL file: `infra/mosquitto/acl.final-demo`.
- Dashboard credentials are read-only and may only subscribe to live topics.
- Backend credentials can subscribe to telemetry/status/heartbeat/events and publish command topics.
- Firmware currently uses an interim `device_demo` role until per-device credential provisioning is available.

Do not commit secrets
---------------------

`infra/mosquitto/passwords` is ignored by git. Generate it locally:

```powershell
mosquitto_passwd -c infra\mosquitto\passwords dashboard
mosquitto_passwd    infra\mosquitto\passwords backend
mosquitto_passwd    infra\mosquitto\passwords device_demo
```

Use strong local demo passwords. Do not put real passwords in `.env.example`, docs, scripts, or source code.

Backend configuration
---------------------

Development mode can leave MQTT credentials blank:

```text
RESQ_MQTT_BROKER_URL=tcp://localhost:1883
RESQ_MQTT_USERNAME=
RESQ_MQTT_PASSWORD=
```

Final/demo mode should use the backend MQTT user:

```text
RESQ_MQTT_BROKER_URL=tcp://localhost:1883
RESQ_MQTT_USERNAME=backend
RESQ_MQTT_PASSWORD=<local-backend-password>
```

The backend subscriber and command publisher share these credentials. The `backend` ACL allows:

- Read `resq/manikins/+/status`
- Read `resq/manikins/+/heartbeat`
- Read `resq/manikins/+/telemetry`
- Read `resq/manikins/+/events`
- Write `resq/manikins/+/cmd/#`

Frontend configuration
----------------------

Development mode can leave dashboard credentials blank.

Final/demo mode may set a read-only demo dashboard credential:

```text
VITE_RESQ_MQTT_WS_URL=ws://localhost:9001
VITE_RESQ_MQTT_DASHBOARD_USERNAME=dashboard
VITE_RESQ_MQTT_DASHBOARD_PASSWORD=<local-read-only-dashboard-password>
```

Important: `VITE_*` values are visible in browser code. Only use the read-only dashboard MQTT user here.

Dashboard ACL
-------------

The `dashboard` user can only read:

- `resq/manikins/+/status`
- `resq/manikins/+/heartbeat`
- `resq/manikins/+/telemetry`
- `resq/manikins/+/events`

The `dashboard` user cannot write telemetry and cannot write command topics such as:

- `resq/manikins/+/cmd/#`
- `resq/manikins/M01/cmd/session/start`
- `resq/manikins/M01/cmd/session/stop`
- `resq/manikins/M01/cmd/device/reset`
- `resq/manikins/M01/cmd/device/unpair`
- `resq/manikins/M01/cmd/config/update`

Firmware/device ACL
-------------------

The current final/demo ACL uses one interim device role:

- User: `device_demo`
- Can write:
  - `resq/manikins/+/status`
  - `resq/manikins/+/heartbeat`
  - `resq/manikins/+/telemetry`
  - `resq/manikins/+/events`
- Can read:
  - `resq/manikins/+/cmd/#`

Future hardening should provision per-device MQTT usernames and replace the shared role with pattern ACLs:

```text
pattern write resq/manikins/%u/status
pattern write resq/manikins/%u/heartbeat
pattern write resq/manikins/%u/telemetry
pattern write resq/manikins/%u/events
pattern read  resq/manikins/%u/cmd/#
```

Start Mosquitto
---------------

Development mode:

```powershell
mosquitto -c infra\mosquitto\mosquitto.dev.conf -v
```

Final/demo mode from this repo root:

```powershell
mosquitto -c infra\mosquitto\mosquitto.final-demo.conf -v
```

If your Mosquitto service expects Linux container paths, mount `infra/mosquitto` as `/mosquitto/config` and adjust `password_file` / `acl_file` paths in a local, uncommitted config copy.

Manual ACL verification
-----------------------

Dashboard can subscribe to live telemetry:

```powershell
mosquitto_sub -h 127.0.0.1 -p 1883 -u dashboard -P <dashboard-password> -t resq/manikins/+/telemetry -C 1
```

In another terminal, publish as device:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u device_demo -P <device-password> -t resq/manikins/M01/telemetry -m "{""deviceId"":""M01"",""sessionId"":""S-SECURITY-SMOKE"",""depthMm"":52,""rateCpm"":110,""recoilOk"":true}"
```

Dashboard cannot publish telemetry:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P <dashboard-password> -t resq/manikins/M01/telemetry -m "{}"
```

Expected: publish is denied by ACL.

Dashboard cannot publish a session start command:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u dashboard -P <dashboard-password> -t resq/manikins/M01/cmd/session/start -m "{}"
```

Expected: publish is denied by ACL.

Backend can publish a session start command:

```powershell
mosquitto_pub -h 127.0.0.1 -p 1883 -u backend -P <backend-password> -t resq/manikins/M01/cmd/session/start -m "{""sessionId"":""S-SECURITY-SMOKE"",""deviceId"":""M01""}"
```

Expected: publish succeeds.

Scripted ACL smoke
------------------

After starting final/demo Mosquitto, run:

```powershell
.\scripts\test-mqtt-security.ps1 `
  -DashboardPassword <dashboard-password> `
  -BackendPassword <backend-password> `
  -DevicePassword <device-password>
```

This verifies:

- Dashboard user cannot publish telemetry.
- Dashboard user cannot publish command topics.
- Device role can publish telemetry.
- Backend user can publish command topics.

Fallback safety checks
----------------------

If dashboard credentials are wrong, the frontend MQTT-over-WebSocket client should fail and fall back:

1. Set an incorrect `VITE_RESQ_MQTT_DASHBOARD_PASSWORD`.
2. Start the frontend.
3. Confirm UI moves from `CONNECTING` to `Backend fallback`.
4. Confirm SSE and REST polling still work.
5. Restore the correct credential and confirm Direct MQTT recovers after the stable window.

Command authority checks
------------------------

- Start Session still calls backend REST.
- End Session still calls backend REST.
- Calibration, reset, diagnostics, pairing, export, and auth remain backend-controlled.
- `scripts/test-live-fallback.ps1 -StaticOnly` scans frontend source for MQTT publish/command-topic code.

Remaining security gaps
-----------------------

- Browser-visible credentials are only acceptable for a read-only demo dashboard user.
- Production should prefer backend-issued short-lived live tokens or a broker auth plugin.
- Firmware still needs per-device credential provisioning before strict `%u` ACLs can replace `device_demo`.
- TLS is not configured in this local demo broker profile.

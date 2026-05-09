# Live Fallback Test Plan

Purpose
-------

This plan verifies the Phase 4-8 live dashboard architecture:

- Direct frontend MQTT-over-WebSocket is the primary live display path.
- Backend SSE is fallback 1.
- Backend REST polling is fallback 2.
- Backend MQTT-over-TCP remains authoritative for validation, scoring, live registry snapshots, session start/end, exports, and future sync.
- Frontend MQTT is display-only and must never publish command topics.

Prerequisites
-------------

- Windows PowerShell.
- Mosquitto broker with:
  - MQTT TCP on `1883`.
  - MQTT-over-WebSocket on `9001`.
- `mosquitto_pub.exe` on `PATH`.
- Backend running on `http://localhost:18080`.
- Frontend running on `http://localhost:1420`.
- An authenticated instructor session in the browser when protected endpoints are enabled.

Quick commands
--------------

Run backend tests:

```powershell
C:\Users\kavis\.m2\wrapper\dists\apache-maven-3.9.14\ed7edd442f634ac1c1ef5ba2b61b6d690b5221091f1a8e1123f5fadcc967520d\bin\mvn.cmd test
```

Run frontend build:

```powershell
cd apps\localhub-desktop
cmd /c npm.cmd run build
```

Publish one metric-first telemetry packet:

```powershell
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Sample metric-first -PrintPayload
```

Run backend fallback smoke checks:

```powershell
.\scripts\test-live-fallback.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -IncludeInvalidSamples
```

If REST endpoints require an auth cookie outside the browser, pass it as:

```powershell
.\scripts\test-live-fallback.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Cookie "resq_session=<cookie-value>" -IncludeInvalidSamples
```

Session setup
-------------

Phase 6 validation rejects arbitrary `sessionId` values. Start a real backend session before publishing accepted telemetry.

1. Open the Instructor Dashboard.
2. Select device `M01` or the target manikin.
3. Start a session through the UI. This keeps command flow on backend REST/MQTT command publishing.
4. Copy the active `sessionId` from the UI or from `GET /api/manikins/live/M01`.

Scenario A - Direct MQTT healthy
--------------------------------

1. Start broker, backend, and frontend.
2. Confirm broker WebSocket port `9001` is enabled.
3. Start an active session for the target device.
4. Open the Instructor Dashboard or Trainee Dashboard for that session.
5. Publish:

   ```powershell
   .\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Sample metric-first
   ```

Expected:

- UI shows `Direct MQTT` / `MQTT_WS_LIVE`.
- Depth shows `52.0 mm`.
- Rate shows `110.0 cpm`.
- Recoil shows `OK`.
- Flags include `DEPTH_OK`, `RATE_OK`, `RECOIL_OK`.
- Backend REST snapshot also has `latestMetric`.

Scenario B - MQTT WebSocket failure
-----------------------------------

1. Keep backend and broker TCP path running.
2. Stop or block only the broker WebSocket listener on port `9001`.
3. Leave broker TCP port `1883` available.
4. Publish telemetry through TCP:

   ```powershell
   .\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 2 -Sample metric-first
   ```

Expected:

- UI switches to `Backend fallback` / `BACKEND_SSE_FALLBACK`.
- Message appears: `Using backend fallback stream. Session recording continues.`
- Metrics still update from backend SSE.
- Backend logs show accepted telemetry and session accumulator updates.
- `GET /api/sessions/live/<ACTIVE_SESSION_ID>` returns the latest metric.

Scenario C - SSE failure
------------------------

Use one of these safe dev simulations:

- Temporarily block `/api/stream/sessions/live/<ACTIVE_SESSION_ID>` and `/api/stream/manikins/live` in browser devtools request blocking.
- Or stop backend briefly after the UI has fallen back to SSE, then restart backend and observe polling recovery.
- Or point the frontend `backendBaseUrl` to a test backend/proxy that fails SSE but allows REST, if available.

Expected:

- UI switches to `Polling degraded` / `BACKEND_POLLING_DEGRADED`.
- Message appears: `Live display is degraded. Data may update slower.`
- Metrics update more slowly from `GET /api/sessions/live/<ACTIVE_SESSION_ID>` or `GET /api/manikins/live/M01`.

Scenario D - stale/offline
--------------------------

1. Restore a healthy direct or fallback live path.
2. Publish one telemetry packet.
3. Stop publishing telemetry.

Expected:

- Active-session data becomes `STALE` after the configured stale threshold, around 2 seconds in the frontend manager.
- Old metric values are visually muted and are not presented as fresh live data.

Then:

1. Publish a heartbeat or status:

   ```powershell
   .\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Sample heartbeat
   ```

2. Stop heartbeat/status publishing.

Expected:

- Device becomes `OFFLINE` after the configured offline threshold, around 8 seconds in the frontend manager.
- Backend registry also marks stale/offline based on its configured `resq.live.stale-after-seconds`.

Scenario E - recovery
---------------------

1. Start with Scenario B or C active.
2. Restore broker WebSocket on port `9001`.
3. Publish healthy metric-first telemetry.
4. Wait through the configured stable recovery window, around 3-5 seconds.

Expected:

- UI returns to `Direct MQTT` / `MQTT_WS_LIVE`.
- Backend fallback warning disappears automatically.
- No duplicate command publishing occurs from the frontend.

Scenario F - validation
-----------------------

Publish invalid samples:

```powershell
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 10 -Sample wrong-session
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 11 -Sample wrong-device
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ENDED_SESSION_ID> -Seq 12 -Sample ended-session
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 13 -Sample malformed
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 14 -Sample incomplete
```

Expected:

- Backend logs rejected telemetry with accepted/rejected counts.
- Backend does not update scoring or active session state from invalid telemetry.
- UI does not update selected metric cards, charts, coaching cues, or compression count from invalid telemetry.
- Backend and frontend do not crash.

Scenario G - metric-first compatibility
---------------------------------------

Publish supported compatibility samples:

```powershell
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 20 -Sample raw
.\scripts\publish-sample-telemetry.ps1 -DeviceId M01 -SessionId <ACTIVE_SESSION_ID> -Seq 21 -Sample debugRaw
```

Expected:

- Raw sample does not crash backend.
- Safe `current_delta` fallback is normalized to `depthMm` and marked as simulator.
- Known `feedback` maps into flags.
- `debugRaw` is preserved by the contract but ignored by normal dashboard cards.

SSE observation helper
----------------------

Use `curl -N` in a separate terminal:

```powershell
curl.exe -N http://localhost:18080/api/stream/sessions/live/<ACTIVE_SESSION_ID>
```

Then publish telemetry and confirm `session-live` events arrive.

Automation coverage
-------------------

Automated:

- Backend unit tests cover active session binding, ended session rejection, sequence rejection, metric-first payloads, legacy raw compatibility, `debugRaw`, and incomplete payload rejection.
- Frontend unit tests cover metric-first normalization, legacy raw conversion, incomplete payload rejection, and strict selected device/session filtering.
- `scripts/test-live-fallback.ps1` checks backend REST fallback snapshots, invalid sample protection, and a static frontend scan for MQTT publish/command-topic code.

Manual:

- Browser Direct MQTT mode.
- MQTT WebSocket failure and recovery.
- SSE failure into polling degraded mode.
- Visual stale/offline state.
- End-to-end session start/end through authenticated UI.

Notes
-----

- Do not use the frontend for session start, stop, calibration, reset, export, or diagnostics over MQTT. Those commands remain backend REST actions.
- Do not change MQTT topic names for tests.
- Do not store smoke-test payloads permanently; scripts write temporary payload files under `%TEMP%` and delete them after publishing.

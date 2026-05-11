# ResQ MQTT Test Report

## Test run metadata

- Date/time: `2026-05-10T10:44:24.632603+00:00`
- Broker: `localhost`
- Port: `1883`
- Device: `resq-node-01`
- Base topic: `resq/manikins/resq-node-01`
- Interactive mode: `True`
- Destructive tests skipped: `True`
- Session tests skipped: `False`
- Calibration tests skipped: `False`

## Summary

| Status | Count |
|---|---:|
| PASS | 21 |
| WARN | 1 |
| FAIL | 0 |
| SKIP | 8 |

## Detailed results

| Test | Status | Name | Command | Actual |
|---|---|---|---|---|
| TC-001 | PASS | MQTT broker reachable |  | Connected and subscribed to ResQ topics |
| TC-002 | PASS | Device publishes status or heartbeat |  | Observed resq/manikins/resq-node-01/status |
| TC-003 | PASS | Topic namespace correctness |  | All observed device topics use canonical namespace: ['resq/manikins/resq-node-01/status'] |
| TC-010 | PASS | Status payload shape |  | Status payload contains required fields |
| TC-011 | PASS | Status retained check |  | Retained status arrived quickly for a reconnecting client |
| TC-020 | PASS | Periodic heartbeat exists |  | Observed 2 heartbeats; intervals=[5.0]s |
| TC-021 | PASS | Heartbeat payload shape |  | Heartbeat contains required health fields and allowed readiness extensions |
| TC-022 | PASS | Heartbeat is low-rate health, not telemetry |  | Heartbeat is low-rate health/readiness; readiness and sensorHealth fields are accepted |
| TC-030 | PASS | cmd/diag/ping | resq/manikins/resq-node-01/cmd/diag/ping | Observed diagnostic response for diag/ping |
| TC-031 | PASS | cmd/diag/request | resq/manikins/resq-node-01/cmd/diag/request | Diagnostic report event was published |
| TC-032 | SKIP | cmd/diag/health support |  | cmd/diag/health is not implemented in inspected firmware sources |
| TC-040 | PASS | calibration/start | resq/manikins/resq-node-01/cmd/calibration/start | Status moved to calibration state |
| TC-041 | PASS | calibration/capture-normal | resq/manikins/resq-node-01/cmd/calibration/capture-normal | calibration/capture-normal ACK was observed |
| TC-042 | PASS | calibration/capture-full-depth | resq/manikins/resq-node-01/cmd/calibration/capture-full-depth | calibration/capture-full-depth ACK was observed |
| TC-043 | PASS | calibration/validate | resq/manikins/resq-node-01/cmd/calibration/validate | calibration_report contains result and readyForSession |
| TC-044 | PASS | calibration/cancel | resq/manikins/resq-node-01/cmd/calibration/cancel | calibration/cancel response or safe status was observed |
| TC-045 | SKIP | calibration commands during active session |  | Could not establish an active session before calibration rejection check |
| TC-050 | PASS | session/start without known readiness | resq/manikins/resq-node-01/cmd/session/start | Session rejected because calibration/profile is not ready: calibration not ready or profile mismatch |
| TC-051 | WARN | session/stop | resq/manikins/resq-node-01/cmd/session/stop | session/stop NACK because no active session exists: no active session |
| TC-052 | SKIP | profile mismatch |  | Readiness for adult-basic-v1 was not established (ready=False, profile=adult-basic-v1, source=resq/manikins/resq-node-01/heartbeat) |
| TC-060 | PASS | Telemetry only during active session |  | No telemetry appeared while latest state was idle/not active |
| TC-061 | SKIP | Metric-first telemetry shape |  | Could not start active session; calibration/readiness may be required |
| TC-062 | SKIP | debugRaw policy |  | No telemetry payload was observed for debugRaw policy inspection |
| TC-063 | PASS | Telemetry non-retained check |  | No retained telemetry arrived immediately |
| TC-070 | PASS | Events topic receives command_result | resq/manikins/resq-node-01/cmd/diag/ping | command_result was published on events |
| TC-071 | PASS | Calibration report event shape |  | calibration_report contains required minimal fields |
| TC-072 | SKIP | Compression feedback event |  | Could not start active session for compression feedback |
| TC-080 | PASS | config/debug update | resq/manikins/resq-node-01/cmd/config/update | config/update ACK was observed; debugRaw setting may have changed |
| TC-090 | SKIP | device/reset |  | Destructive reset skipped by default; use --interactive --no-skip-destructive to run |
| TC-091 | SKIP | device/unpair |  | Destructive unpair skipped by default; use --interactive --no-skip-destructive to run |

## Per-test details

### TC-001: MQTT broker reachable

- Status: `PASS`
- Purpose: Verify the test runner can connect to the configured MQTT broker.
- Expected: MQTT connection succeeds.
- Actual: Connected and subscribed to ResQ topics
- Started: `2026-05-10T10:43:32.379055+00:00`
- Ended: `2026-05-10T10:43:34.496163+00:00`

### TC-002: Device publishes status or heartbeat

- Status: `PASS`
- Purpose: Verify the target device is visible on the broker.
- Expected: A status or heartbeat message appears within the timeout.
- Actual: Observed resq/manikins/resq-node-01/status
- Started: `2026-05-10T10:43:34.496177+00:00`
- Ended: `2026-05-10T10:43:34.596763+00:00`
- Matched messages:
  - `2026-05-10T10:43:34.496485+00:00` `resq/manikins/resq-node-01/status` retained=True payload=`{"device_id":"resq-node-01","state":"CALIBRATION_FAIL","session_active":false,"session_id":""}`

### TC-003: Topic namespace correctness

- Status: `PASS`
- Purpose: Check observed device topics use the canonical ResQ namespace.
- Expected: Observed target-device topics start with resq/manikins/<device_id>/.
- Actual: All observed device topics use canonical namespace: ['resq/manikins/resq-node-01/status']
- Started: `2026-05-10T10:43:34.596790+00:00`
- Ended: `2026-05-10T10:43:34.596810+00:00`
- Matched messages:
  - `2026-05-10T10:43:34.496485+00:00` `resq/manikins/resq-node-01/status` retained=True payload=`{"device_id":"resq-node-01","state":"CALIBRATION_FAIL","session_active":false,"session_id":""}`

### TC-010: Status payload shape

- Status: `PASS`
- Purpose: Validate the minimum status schema used by local hub integrations.
- Expected: Status includes device_id/deviceId, state, session_active/sessionActive, and session_id/sessionId.
- Actual: Status payload contains required fields
- Started: `2026-05-10T10:43:34.596814+00:00`
- Ended: `2026-05-10T10:43:34.596829+00:00`
- Matched messages:
  - `2026-05-10T10:43:34.496485+00:00` `resq/manikins/resq-node-01/status` retained=True payload=`{"device_id":"resq-node-01","state":"CALIBRATION_FAIL","session_active":false,"session_id":""}`

### TC-011: Status retained check

- Status: `PASS`
- Purpose: Verify a reconnecting observer can obtain the latest status quickly.
- Expected: A retained status arrives quickly, or live status appears later as WARN.
- Actual: Retained status arrived quickly for a reconnecting client
- Started: `2026-05-10T10:43:34.596831+00:00`
- Ended: `2026-05-10T10:43:38.627977+00:00`
- Matched messages:
  - `2026-05-10T10:43:36.627708+00:00` `resq/manikins/resq-node-01/status` retained=True payload=`{"device_id":"resq-node-01","state":"CALIBRATION_FAIL","session_active":false,"session_id":""}`

### TC-020: Periodic heartbeat exists

- Status: `PASS`
- Purpose: Verify the firmware publishes low-rate heartbeat health updates.
- Expected: At least two heartbeat messages arrive within a reasonable time.
- Actual: Observed 2 heartbeats; intervals=[5.0]s
- Started: `2026-05-10T10:43:38.628011+00:00`
- Ended: `2026-05-10T10:43:40.234126+00:00`
- Matched messages:
  - `2026-05-10T10:43:35.173138+00:00` `resq/manikins/resq-node-01/heartbeat` retained=False payload=`{"device_id":"resq-node-01","wifi_connected":true,"mqtt_connected":true,"session_active":false,"sensor_running":false,"session_id":"","ip":"192.168.8.161","force1_ok":true,"force2_ok":true,"hall_ok":true,"compression_count":0,"calibrationReady":false,"calibrationState":"NONE","profileId":"adult-basic-v1","lastCalibrationResult":"NONE","debugRawEnabled":false,"sensorMode":"IDLE","sensorHealth":{"force1Ok":true,"force2Ok":true,"hallOk":true}}`
  - `2026-05-10T10:43:40.172022+00:00` `resq/manikins/resq-node-01/heartbeat` retained=False payload=`{"device_id":"resq-node-01","wifi_connected":true,"mqtt_connected":true,"session_active":false,"sensor_running":false,"session_id":"","ip":"192.168.8.161","force1_ok":true,"force2_ok":true,"hall_ok":true,"compression_count":0,"calibrationReady":false,"calibrationState":"NONE","profileId":"adult-basic-v1","lastCalibrationResult":"NONE","debugRawEnabled":false,"sensorMode":"IDLE","sensorHealth":{"force1Ok":true,"force2Ok":true,"hallOk":true}}`

### TC-021: Heartbeat payload shape

- Status: `PASS`
- Purpose: Validate the heartbeat health/readiness schema.
- Expected: Heartbeat includes required health fields; readiness and sensor health extensions are allowed.
- Actual: Heartbeat contains required health fields and allowed readiness extensions
- Started: `2026-05-10T10:43:40.234137+00:00`
- Ended: `2026-05-10T10:43:40.234153+00:00`
- Matched messages:
  - `2026-05-10T10:43:40.172022+00:00` `resq/manikins/resq-node-01/heartbeat` retained=False payload=`{"device_id":"resq-node-01","wifi_connected":true,"mqtt_connected":true,"session_active":false,"sensor_running":false,"session_id":"","ip":"192.168.8.161","force1_ok":true,"force2_ok":true,"hall_ok":true,"compression_count":0,"calibrationReady":false,"calibrationState":"NONE","profileId":"adult-basic-v1","lastCalibrationResult":"NONE","debugRawEnabled":false,"sensorMode":"IDLE","sensorHealth":{"force1Ok":true,"force2Ok":true,"hallOk":true}}`

### TC-022: Heartbeat is low-rate health, not telemetry

- Status: `PASS`
- Purpose: Confirm heartbeat is not being used as the live metric stream.
- Expected: Heartbeat does not carry continuous compression metrics as its primary payload.
- Actual: Heartbeat is low-rate health/readiness; readiness and sensorHealth fields are accepted
- Started: `2026-05-10T10:43:40.234156+00:00`
- Ended: `2026-05-10T10:43:40.234167+00:00`
- Matched messages:
  - `2026-05-10T10:43:40.172022+00:00` `resq/manikins/resq-node-01/heartbeat` retained=False payload=`{"device_id":"resq-node-01","wifi_connected":true,"mqtt_connected":true,"session_active":false,"sensor_running":false,"session_id":"","ip":"192.168.8.161","force1_ok":true,"force2_ok":true,"hall_ok":true,"compression_count":0,"calibrationReady":false,"calibrationState":"NONE","profileId":"adult-basic-v1","lastCalibrationResult":"NONE","debugRawEnabled":false,"sensorMode":"IDLE","sensorHealth":{"force1Ok":true,"force2Ok":true,"hallOk":true}}`

### TC-030: cmd/diag/ping

- Status: `PASS`
- Purpose: Verify the diagnostic ping command returns an event response.
- Expected: A command_result or diagnostic event is published on events.
- Command topic: `resq/manikins/resq-node-01/cmd/diag/ping`
- Command payload: `{"commandId":"PING-001"}`
- Actual: Observed diagnostic response for diag/ping
- Started: `2026-05-10T10:43:40.234171+00:00`
- Ended: `2026-05-10T10:43:40.335250+00:00`
- Matched messages:
  - `2026-05-10T10:43:40.322695+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"diag/ping","status":"ACK","reason":"device alive"}`

### TC-031: cmd/diag/request

- Status: `PASS`
- Purpose: Verify diagnostic report requests produce a diagnostic event.
- Expected: A diagnostic_report event appears; command_result-only ACK is WARN.
- Command topic: `resq/manikins/resq-node-01/cmd/diag/request`
- Command payload: `{"commandId":"DIAG-001"}`
- Actual: Diagnostic report event was published
- Started: `2026-05-10T10:43:40.335261+00:00`
- Ended: `2026-05-10T10:43:40.737194+00:00`
- Matched messages:
  - `2026-05-10T10:43:40.683213+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","event_type":"diagnostic_report","session_active":false,"session_id":"","sensor_running":false,"force1_ok":true,"force2_ok":true,"hall_ok":true,"depthMm":78.38710021972656,"rateCpm":0,"pauseS":0,"recoilOk":false,"compression_count":0,"debugRaw":{"force1":5477686,"force2":4992637,"hallRaw":2446,"hallFiltered":2448,"currentDelta":972}}`
  - `2026-05-10T10:43:40.683695+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"diag/request","status":"ACK","reason":"diagnostic event published"}`

### TC-032: cmd/diag/health support

- Status: `SKIP`
- Purpose: Check whether the health diagnostic command is implemented and subscribed.
- Expected: If supported and subscribed, command returns a response; unsupported commands are SKIP.
- Actual: cmd/diag/health is not implemented in inspected firmware sources
- Started: `2026-05-10T10:43:40.737211+00:00`
- Ended: `2026-05-10T10:43:40.738516+00:00`
- Notes: source_checked=['components\\messaging\\mqtt_manager.c', 'components\\protocol\\include\\resq_protocol.h', 'components\\runtime\\command_handler.c', 'docs\\resq-firmware-current-status-report.md']; handler_exists=False; protocol_declares=False; subscribed=False

### TC-040: calibration/start

- Status: `PASS`
- Purpose: Verify calibration start command behavior without assuming calibration can complete.
- Expected: ACK/status CALIBRATING, or NACK/WARN for valid current-state constraints.
- Command topic: `resq/manikins/resq-node-01/cmd/calibration/start`
- Command payload: `{"profileId":"adult-basic-v1","commandId":"CAL-START-001"}`
- Actual: Status moved to calibration state
- Started: `2026-05-10T10:43:40.738530+00:00`
- Ended: `2026-05-10T10:43:40.940462+00:00`
- Matched messages:
  - `2026-05-10T10:43:40.849193+00:00` `resq/manikins/resq-node-01/status` retained=False payload=`{"device_id":"resq-node-01","state":"CALIBRATING","session_active":false,"session_id":""}`

### TC-041: calibration/capture-normal

- Status: `PASS`
- Purpose: Verify normal calibration capture command response.
- Expected: A command_result ACK/NACK response appears.
- Command topic: `resq/manikins/resq-node-01/cmd/calibration/capture-normal`
- Command payload: `{"profileId":"adult-basic-v1","commandId":"CAL-CAP-NORM-001","windowMs":3000}`
- Actual: calibration/capture-normal ACK was observed
- Started: `2026-05-10T10:43:40.940489+00:00`
- Ended: `2026-05-10T10:43:42.748777+00:00`
- Matched messages:
  - `2026-05-10T10:43:42.652210+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"calibration/capture-normal","status":"ACK","reason":"normal position captured"}`

### TC-042: calibration/capture-full-depth

- Status: `PASS`
- Purpose: Verify full-depth calibration capture when a user can perform the action.
- Expected: Interactive mode only; command_result ACK/NACK response appears.
- Command topic: `resq/manikins/resq-node-01/cmd/calibration/capture-full-depth`
- Command payload: `{"profileId":"adult-basic-v1","commandId":"CAL-CAP-FULL-001","windowMs":3000}`
- Actual: calibration/capture-full-depth ACK was observed
- Started: `2026-05-10T10:43:55.895620+00:00`
- Ended: `2026-05-10T10:43:59.007242+00:00`
- Matched messages:
  - `2026-05-10T10:43:58.953295+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"calibration/capture-full-depth","status":"ACK","reason":"full compression depth captured"}`

### TC-043: calibration/validate

- Status: `PASS`
- Purpose: Verify calibration validation emits command/report evidence.
- Expected: A calibration_report with result and readyForSession, or command_result-only WARN.
- Command topic: `resq/manikins/resq-node-01/cmd/calibration/validate`
- Command payload: `{"profileId":"adult-basic-v1","commandId":"CAL-VALID-001"}`
- Actual: calibration_report contains result and readyForSession
- Started: `2026-05-10T10:43:59.007270+00:00`
- Ended: `2026-05-10T10:43:59.108462+00:00`
- Matched messages:
  - `2026-05-10T10:43:59.079764+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"calibration/validate","status":"ACK","reason":"calibration failed"}`
  - `2026-05-10T10:43:59.080111+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"event_type":"calibration_report","device_id":"resq-node-01","profileId":"adult-basic-v1","result":"FAIL","readyForSession":false}`

### TC-044: calibration/cancel

- Status: `PASS`
- Purpose: Verify calibration cancel returns the firmware to a safe state.
- Expected: A command_result and/or status transition appears.
- Command topic: `resq/manikins/resq-node-01/cmd/calibration/cancel`
- Command payload: `{"profileId":"adult-basic-v1","commandId":"CAL-CANCEL-001"}`
- Actual: calibration/cancel response or safe status was observed
- Started: `2026-05-10T10:43:59.108479+00:00`
- Ended: `2026-05-10T10:43:59.410320+00:00`
- Matched messages:
  - `2026-05-10T10:43:59.393279+00:00` `resq/manikins/resq-node-01/status` retained=False payload=`{"device_id":"resq-node-01","state":"IDLE","session_active":false,"session_id":""}`

### TC-045: calibration commands during active session

- Status: `SKIP`
- Purpose: Verify active sessions reject calibration start.
- Expected: Interactive/session-enabled mode only; calibration/start is rejected while active.
- Actual: Could not establish an active session before calibration rejection check
- Started: `2026-05-10T10:43:59.410333+00:00`
- Ended: `2026-05-10T10:43:59.711581+00:00`

### TC-050: session/start without known readiness

- Status: `PASS`
- Purpose: Validate session start behavior against current calibration readiness.
- Expected: NACK when calibration is not ready, or ACK/session active when readiness allows it.
- Command topic: `resq/manikins/resq-node-01/cmd/session/start`
- Command payload: `{"sessionId":"TEST-S-001","profileId":"adult-basic-v1","commandId":"START-001"}`
- Actual: Session rejected because calibration/profile is not ready: calibration not ready or profile mismatch
- Started: `2026-05-10T10:43:59.711602+00:00`
- Ended: `2026-05-10T10:44:09.752691+00:00`
- Matched messages:
  - `2026-05-10T10:43:59.907378+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"session/start","status":"NACK","reason":"calibration not ready or profile mismatch"}`

### TC-051: session/stop

- Status: `WARN`
- Purpose: Verify stop command behavior for active or inactive sessions.
- Expected: ACK/status IDLE or READY, or NACK/WARN when no session is active.
- Command topic: `resq/manikins/resq-node-01/cmd/session/stop`
- Command payload: `{"sessionId":"TEST-S-001","commandId":"STOP-001"}`
- Actual: session/stop NACK because no active session exists: no active session
- Started: `2026-05-10T10:44:09.752709+00:00`
- Ended: `2026-05-10T10:44:09.853663+00:00`
- Matched messages:
  - `2026-05-10T10:44:09.826944+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"session/stop","status":"NACK","reason":"no active session"}`

### TC-052: profile mismatch

- Status: `SKIP`
- Purpose: Verify a ready calibration profile is not accepted for a mismatched session profile.
- Expected: NACK for mismatched profile when adult-basic-v1 readiness is established.
- Actual: Readiness for adult-basic-v1 was not established (ready=False, profile=adult-basic-v1, source=resq/manikins/resq-node-01/heartbeat)
- Started: `2026-05-10T10:44:09.853682+00:00`
- Ended: `2026-05-10T10:44:09.853703+00:00`

### TC-060: Telemetry only during active session

- Status: `PASS`
- Purpose: Verify telemetry is not continuously published while idle.
- Expected: No continuous telemetry appears while session_active is false.
- Actual: No telemetry appeared while latest state was idle/not active
- Started: `2026-05-10T10:44:09.853707+00:00`
- Ended: `2026-05-10T10:44:19.887787+00:00`

### TC-061: Metric-first telemetry shape

- Status: `SKIP`
- Purpose: Verify active-session telemetry is metric-first instead of raw-heavy.
- Expected: Telemetry includes depthMm, rateCpm, recoilOk, pauseS, compressionCount, handPlacement, and flags.
- Actual: Could not start active session; calibration/readiness may be required
- Started: `2026-05-10T10:44:19.887813+00:00`
- Ended: `2026-05-10T10:44:19.988806+00:00`

### TC-062: debugRaw policy

- Status: `SKIP`
- Purpose: Verify raw readings stay inside debugRaw when present.
- Expected: Raw values appear only under debugRaw; debugRawEnabled controls debugRaw presence.
- Actual: No telemetry payload was observed for debugRaw policy inspection
- Started: `2026-05-10T10:44:19.988824+00:00`
- Ended: `2026-05-10T10:44:19.988838+00:00`

### TC-063: Telemetry non-retained check

- Status: `PASS`
- Purpose: Verify reconnecting observers do not receive stale retained telemetry.
- Expected: Old retained telemetry does not arrive immediately.
- Actual: No retained telemetry arrived immediately
- Started: `2026-05-10T10:44:19.988841+00:00`
- Ended: `2026-05-10T10:44:24.027248+00:00`

### TC-070: Events topic receives command_result

- Status: `PASS`
- Purpose: Verify a simple command publishes command_result on events.
- Expected: cmd/diag/ping produces command_result on events.
- Command topic: `resq/manikins/resq-node-01/cmd/diag/ping`
- Command payload: `{"commandId":"PING-EVENT-001"}`
- Actual: command_result was published on events
- Started: `2026-05-10T10:44:24.027261+00:00`
- Ended: `2026-05-10T10:44:24.228623+00:00`
- Matched messages:
  - `2026-05-10T10:44:24.162949+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"diag/ping","status":"ACK","reason":"device alive"}`

### TC-071: Calibration report event shape

- Status: `PASS`
- Purpose: Inspect calibration_report event shape when validation produces one.
- Expected: event_type, device_id, profileId, result, and readyForSession exist.
- Actual: calibration_report contains required minimal fields
- Started: `2026-05-10T10:44:24.228642+00:00`
- Ended: `2026-05-10T10:44:24.228675+00:00`
- Matched messages:
  - `2026-05-10T10:43:59.080111+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"event_type":"calibration_report","device_id":"resq-node-01","profileId":"adult-basic-v1","result":"FAIL","readyForSession":false}`

### TC-072: Compression feedback event

- Status: `SKIP`
- Purpose: Verify compression feedback events during an interactive active session.
- Expected: Interactive mode only; compression_feedback or equivalent event appears.
- Actual: Could not start active session for compression feedback
- Started: `2026-05-10T10:44:24.228682+00:00`
- Ended: `2026-05-10T10:44:24.430534+00:00`

### TC-080: config/debug update

- Status: `PASS`
- Purpose: Verify debugRaw config update command produces an explicit response.
- Expected: ACK/NACK command_result with a clear reason when rejected.
- Command topic: `resq/manikins/resq-node-01/cmd/config/update`
- Command payload: `{"debugRawEnabled":true}`
- Actual: config/update ACK was observed; debugRaw setting may have changed
- Started: `2026-05-10T10:44:24.430552+00:00`
- Ended: `2026-05-10T10:44:24.632249+00:00`
- Matched messages:
  - `2026-05-10T10:44:24.624166+00:00` `resq/manikins/resq-node-01/events` retained=False payload=`{"device_id":"resq-node-01","session_id":"","event_type":"command_result","command":"config/update","status":"ACK","reason":""}`

### TC-090: device/reset

- Status: `SKIP`
- Purpose: Verify reset command behavior only when explicitly allowed.
- Expected: Interactive destructive mode only; reset event/status or disconnect/reboot occurs.
- Actual: Destructive reset skipped by default; use --interactive --no-skip-destructive to run
- Started: `2026-05-10T10:44:24.632264+00:00`
- Ended: `2026-05-10T10:44:24.632270+00:00`

### TC-091: device/unpair

- Status: `SKIP`
- Purpose: Verify unpair command behavior only when explicitly allowed.
- Expected: Interactive destructive mode only; unpair/reset/provisioning behavior occurs.
- Actual: Destructive unpair skipped by default; use --interactive --no-skip-destructive to run
- Started: `2026-05-10T10:44:24.632275+00:00`
- Ended: `2026-05-10T10:44:24.632277+00:00`

## Observed topic list

- `resq/manikins/resq-node-01/events`
- `resq/manikins/resq-node-01/heartbeat`
- `resq/manikins/resq-node-01/status`

## Observed payload shape summary

- `resq/manikins/resq-node-01/status` (9 JSON messages): device_id:str, session_active:bool, session_id:str, state:str
- `resq/manikins/resq-node-01/heartbeat` (10 JSON messages): calibrationReady:bool, calibrationState:str, compression_count:int, debugRawEnabled:bool, device_id:str, force1_ok:bool, force2_ok:bool, hall_ok:bool, ip:str, lastCalibrationResult:str, mqtt_connected:bool, profileId:str, sensorHealth:object, sensorMode:str, sensor_running:bool, session_active:bool, session_id:str, wifi_connected:bool
- `resq/manikins/resq-node-01/events` (17 JSON messages): calibrationRequired:bool, command:str, compression_count:int, debugRaw:object, debugRawEnabled:bool, depthMm:float, device_id:str, event_type:str, force1_ok:bool, force2_ok:bool, hall_ok:bool, pauseS:int, profileId:str, rateCpm:int, readyForSession:bool, reason:str, recoilOk:bool, result:str, sensor_running:bool, session_active:bool, session_id:str, status:str

## Firmware behavior conclusions

- The run produced structured evidence for all MQTT test cases; see detailed results for WARN/SKIP context.

## Recommended next actions

- Address any WARN/SKIP preconditions, then rerun with --interactive for hardware-dependent coverage.

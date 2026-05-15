# ResQ Firmware Hardware Edge Test Guide

This README explains how to run the improved ResQ firmware hardware/MQTT test suite and how to manually perform the parts that require the real ESP32-C3, sensors, pressure/bladder setup, and Hall sensor movement.

## Files

| File | Purpose |
|---|---|
| `resq_firmware_hardware_edge_test.py` | Improved Python test harness for firmware MQTT/state/calibration testing. |
| `resq_firmware_test_report.json` | Output report generated after running the script. |

## What this test covers

The test is designed for the current firmware flow:

```text
BOOT
→ CONFIG_CHECK
→ PROVISIONING
→ WIFI_CONNECTING
→ BACKEND_REGISTERING
→ MQTT_CONNECTING
→ PAIRED_IDLE
→ CALIBRATING
→ READY_FOR_SESSION / CALIBRATION_FAIL
```

It validates:

- Mock backend registration endpoint.
- MQTT broker connectivity.
- Device discovery through backend registration or MQTT messages.
- Status topic state names.
- Heartbeat payload quality.
- Topic namespace hygiene.
- `cmd/debug` and `debug` reply.
- Unknown command safe rejection.
- Invalid JSON safe rejection.
- Invalid calibration payload safe rejection.
- Zero/negative calibration value edge cases.
- Cancel calibration while idle.
- Automatic calibration start.
- Calibration progress events.
- Final calibration result / final state.
- Session-start readiness gate if enabled.

## Important correction in the improved script

The earlier script could accidentally count its own command message as a firmware reply. For example, when it published:

```text
resq/{deviceId}/cmd/debug
```

it could treat that command topic as the `debug` reply because the topic ended with `debug`.

The improved script now ignores every topic whose suffix starts with:

```text
cmd/
```

when checking firmware replies.

So valid firmware replies must come from topics such as:

```text
resq/{deviceId}/debug
resq/{deviceId}/status
resq/{deviceId}/heartbeat
resq/{deviceId}/events
resq/{deviceId}/events/calibration/progress
resq/{deviceId}/events/calibration/result
resq/{deviceId}/events/error
```

## Requirements

Install Python dependency:

```powershell
pip install paho-mqtt
```

Optional QR dependency:

```powershell
pip install qrcode[pil]
```

You also need one of these:

- Mosquitto installed locally, or
- an already running MQTT broker on the same LAN.

## Recommended terminal setup

Use 3 terminals.

### Terminal 1: ESP-IDF monitor

Go to firmware repo:

```powershell
cd D:\Academics\SEM6\3YP\e21-3yp-ResQ\code\resq-firmware
```

Build, flash, and monitor:

```powershell
idf.py -p COMx flash monitor
```

Replace `COMx` with your ESP port, for example:

```powershell
idf.py -p COM6 flash monitor
```

Watch for:

```text
BOOT
CONFIG_CHECK
PROVISIONING
WIFI_CONNECTING
BACKEND_REGISTERING
MQTT_CONNECTING
PAIRED_IDLE
```

### Terminal 2: Run the Python test harness

Go to the folder where the test file exists:

```powershell
cd D:\Academics\SEM6\3YP\e21-3yp-ResQ\code\resq-firmware\test_files
```

Run the basic test first:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --wifi-ssid "YOUR_WIFI_SSID" `
  --wifi-pass "YOUR_WIFI_PASSWORD" `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --edge-tests `
  --manual-checklist
```

Change `192.168.8.187` to your laptop LAN IP.

If Mosquitto is already running, add:

```powershell
--no-broker
```

Example:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --wifi-ssid "Dialog 4G 7A5" `
  --wifi-pass "YOUR_PASSWORD" `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --edge-tests `
  --no-broker `
  --manual-checklist
```

### Terminal 3: Optional MQTT monitor

This is useful for seeing all MQTT traffic directly.

```powershell
mosquitto_sub -h 192.168.8.187 -p 1883 -t "resq/#" -v
```

If testing on localhost:

```powershell
mosquitto_sub -h localhost -p 1883 -t "resq/#" -v
```

## Provisioning procedure

When the script starts, it prints:

- Wi-Fi SSID
- Wi-Fi password
- Backend URL
- Register URL
- MQTT host
- MQTT port
- Optional QR/autofill URL

If the ESP starts in provisioning mode:

1. Connect your phone or PC to the ESP SoftAP.
2. Open the provisioning page, usually:

```text
http://192.168.4.1
```

3. Enter the values printed by the Python script.
4. Submit and wait for the ESP to reboot/reconnect.
5. The Python script should discover the device through mock backend registration or MQTT status.

## Test modes

### 1. Basic non-calibration test

Use this when you only want to verify provisioning, registration, MQTT, status, heartbeat, debug, and edge-case command rejection.

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --wifi-ssid "YOUR_WIFI_SSID" `
  --wifi-pass "YOUR_WIFI_PASSWORD" `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --edge-tests
```

### 2. Automatic calibration test

Use this when the real sensors are connected and you are ready to perform manual pressure/compression steps.

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --wifi-ssid "YOUR_WIFI_SSID" `
  --wifi-pass "YOUR_WIFI_PASSWORD" `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --edge-tests `
  --run-calibration `
  --calibration-timeout 240
```

During this test, watch the Python output, MQTT monitor, and ESP-IDF monitor.

You must manually perform the required hardware actions when progress events appear.

## Manual hardware actions during calibration

The firmware publishes calibration progress steps on:

```text
resq/{deviceId}/events/calibration/progress
```

Follow this guide:

| Progress step | Manual action |
|---|---|
| `CALIBRATION_STARTED` | Stop touching the sensors unless instructed. |
| `WAITING_REF_PRESSURE` | Apply the expected reference pressure. |
| `REF_PRESSURE_MATCHED` | Hold/release as instructed by firmware behavior. |
| `WAITING_BLADDER_1_PRESSURE` | Apply bladder 1 pressure target. |
| `BLADDER_1_PRESSURE_MATCHED` | Bladder 1 target was accepted. |
| `WAITING_BLADDER_2_PRESSURE` | Apply bladder 2 pressure target. |
| `BLADDER_2_PRESSURE_MATCHED` | Bladder 2 target was accepted. |
| `HALL_BASELINE_CAPTURED` | Keep manikin at rest; baseline captured. |
| `WAITING_FULL_PRESS` | Compress chest to full target depth. |
| `FULL_PRESS_CAPTURED` | Full press was accepted. |
| `CALIBRATION_SAVED` | Calibration passed and was saved. |
| `CALIBRATION_FAILED` | Check sensor wiring/pressure values/timeout. |

## Calibration command payload used by the script

The script sends:

```json
{
  "command_id": "cmd-cal-...",
  "event_type": "calibration_start",
  "hall_delta": 13500,
  "ref_pressure": 20100,
  "bladder_1_pressure": 15000,
  "bladder_2_pressure": 15000,
  "issued_at_ms": 123456
}
```

You can change these from command line:

```powershell
--hall-delta 13500 `
--ref-pressure 20100 `
--bladder-1-pressure 15000 `
--bladder-2-pressure 15000
```

Example:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --run-calibration `
  --hall-delta 12000 `
  --ref-pressure 20000 `
  --bladder-1-pressure 15000 `
  --bladder-2-pressure 15000
```

## Manual MQTT commands

These are useful when you want to test manually without the Python script.

Replace:

```text
<deviceId>
```

with the actual device ID, for example:

```text
resq-node-925da4
```

### Debug request

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/debug" -m "{`"command_id`":`"cmd-manual-debug`",`"event_type`":`"debug_req`",`"issued_at_ms`":51000}"
```

Expected reply:

```text
resq/<deviceId>/debug
```

Expected payload fields:

```json
{
  "device_id": "resq-node-01",
  "pressure_0_raw": 1230,
  "pressure_1_raw": 1650,
  "pressure_2_raw": 1640,
  "hall_raw": 2990,
  "ts_ms": 76200
}
```

### Start automatic calibration

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/calibration/start" -m "{`"command_id`":`"cmd-manual-cal`",`"event_type`":`"calibration_start`",`"hall_delta`":13500,`"ref_pressure`":20100,`"bladder_1_pressure`":15000,`"bladder_2_pressure`":15000,`"issued_at_ms`":51000}"
```

Expected replies:

```text
resq/<deviceId>/events/calibration/result
resq/<deviceId>/events/calibration/progress
resq/<deviceId>/status
```

### Cancel calibration

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/calibration/cancel" -m "{`"command_id`":`"cmd-manual-cancel`",`"event_type`":`"calibration_cancel`",`"issued_at_ms`":53000}"
```

Expected result:

```text
state = PAIRED_IDLE
```

or:

```text
result = CANCELLED
```

### Invalid calibration payload

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/calibration/start" -m "{`"command_id`":`"cmd-invalid`",`"event_type`":`"calibration_start`"}"
```

Expected behavior:

```text
NACK or events/error
state remains PAIRED_IDLE
must NOT enter ERROR
```

### Unknown command

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/unknown/test" -m "{`"command_id`":`"cmd-unknown`",`"event_type`":`"unknown_command_test`",`"issued_at_ms`":51000}"
```

Expected behavior:

```text
NACK or ignored safely
must NOT crash
must NOT enter ERROR
```

### Session start gate

Only run this if you want to verify whether session start is blocked before readiness or accepted after calibration.

```powershell
mosquitto_pub -h 192.168.8.187 -p 1883 -t "resq/<deviceId>/cmd/session/start" -m "{`"command_id`":`"cmd-session-test`",`"event_type`":`"session_start`",`"session_id`":`"S-TEST-001`",`"profile_id`":`"adult-basic-test`",`"trainee_id`":`"T-TEST-001`",`"issued_at_ms`":51000}"
```

Expected before calibration:

```text
NACK: calibration_not_ready
```

Expected after calibration, if session runtime is implemented:

```text
SESSION_ACTIVE
```

If session runtime is not implemented yet, expected safe behavior:

```text
NACK: session_start_not_implemented_yet
```

## Output report

The script writes:

```text
resq_firmware_test_report.json
```

You can change this:

```powershell
--report-json .\reports\hardware-edge-report.json
```

Example:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --host-ip 192.168.8.187 `
  --topic-style short `
  --edge-tests `
  --report-json .\reports\hardware-edge-report.json
```

## How to interpret results

| Status | Meaning |
|---|---|
| `PASS` | Expected behavior observed. |
| `WARN` | Device responded partly, or the result may depend on incomplete firmware/hardware state. Review details. |
| `FAIL` | Expected behavior was not observed, or firmware entered a dangerous/wrong state. |
| `SKIP` | Test was intentionally skipped due to command-line options. |

## Common failures and fixes

### No device discovered

Possible causes:

- ESP not provisioned.
- Wrong Wi-Fi SSID/password.
- Laptop IP changed.
- Backend URL in provisioning form is wrong.
- Firewall blocks Python mock backend.
- ESP cannot reach broker at laptop IP.

Fix:

```powershell
ipconfig
```

Confirm the correct IPv4 address and rerun with:

```powershell
--host-ip <correct-ip>
```

### Debug command returns the command payload itself

This should be fixed in the improved script. If it still appears, the MQTT monitor is seeing command topics and your firmware did not publish a `debug` reply.

Expected reply topic must be:

```text
resq/{deviceId}/debug
```

not:

```text
resq/{deviceId}/cmd/debug
```

### Calibration never finishes

Possible causes:

- Manual pressure target not reached.
- Sensor wiring order wrong.
- `hall_delta` unrealistic.
- Bladder pressure values unrealistic.
- Timeout too short.
- Sensor task cannot read HX710/Hall properly.

Try:

```powershell
--calibration-timeout 300
```

and watch debug values with:

```powershell
mosquitto_sub -h 192.168.8.187 -p 1883 -t "resq/#" -v
```

### Invalid payload enters ERROR

This is a firmware bug.

Invalid command payloads should:

```text
NACK + stay PAIRED_IDLE
```

They should not move to:

```text
ERROR
```

### Topic style mismatch

This test defaults to:

```text
resq/{deviceId}/...
```

If firmware uses canonical topics:

```text
resq/manikins/{deviceId}/...
```

run:

```powershell
--topic-style canonical
```

If you are unsure, use:

```powershell
--topic-style both
```

## Recommended final hardware validation sequence

1. `idf.py build`
2. `idf.py -p COMx flash monitor`
3. Run basic test:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --host-ip 192.168.8.187 `
  --wifi-ssid "YOUR_WIFI" `
  --wifi-pass "YOUR_PASSWORD" `
  --topic-style short `
  --edge-tests
```

4. Fix any FAIL in provisioning/MQTT/status/debug.
5. Run calibration test:

```powershell
python .\resq_firmware_hardware_edge_test.py `
  --host-ip 192.168.8.187 `
  --wifi-ssid "YOUR_WIFI" `
  --wifi-pass "YOUR_PASSWORD" `
  --topic-style short `
  --edge-tests `
  --run-calibration `
  --calibration-timeout 240
```

6. Manually apply pressure/compressions according to progress events.
7. Confirm final state:

```text
READY_FOR_SESSION
```

or, if calibration fails due to hardware, confirm clean failure:

```text
CALIBRATION_FAIL
```

8. Confirm firmware returns to command-ready state and can retry calibration.

## Commit suggestion

After placing these files in `test_files/`, commit them separately:

```powershell
git add test_files/resq_firmware_hardware_edge_test.py test_files/RESQ_FIRMWARE_HARDWARE_TEST_README.md
git commit -m "test(firmware): add hardware edge-case MQTT test harness"
```

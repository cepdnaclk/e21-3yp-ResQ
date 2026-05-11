# ResQ MQTT Test Implementation

This document explains the `test_files` package used to exercise the current
ResQ firmware MQTT behavior and collect evidence.

## Folder Structure

- `test_files/payloads/` - JSON command payloads used by the runner and manual publish helper.
- `test_files/scripts/` - MQTT helper scripts, Mosquitto config, mock registration server, and the canonical MQTT test runner.
- `test_files/docs/` - test implementation and usage documentation.
- `test_files/evidence/` - generated test reports and MQTT message logs.

## Required Tools

- Python 3
- `paho-mqtt`
- An MQTT broker, such as Mosquitto
- Optional Mosquitto CLI tools, `mosquitto_pub` and `mosquitto_sub`, for manual checks

Install the Python dependency:

```powershell
python -m pip install paho-mqtt
```

## Start Mosquitto

The repository includes a simple anonymous local broker config:

```powershell
mosquitto -c test_files/scripts/mosquitto-resq.conf -v
```

The config listens on `0.0.0.0:1883`, which lets the ESP32-C3 connect when its
MQTT host points to the machine running Mosquitto.

## Mock Registration Server

If the firmware flow needs a registration endpoint before MQTT can be used,
start the mock registration server in a second terminal:

```powershell
python test_files/scripts/mock_register.py
```

Use this only when the current firmware build expects local registration during
provisioning or boot.

## Run The MQTT Test Runner

The canonical runner is:

```powershell
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --device resq-node-01
```

Useful options:

```powershell
python test_files/scripts/resq_mqtt_test_runner.py --help
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --port 1883 --device resq-node-01 --timeout 10
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --device resq-node-01 --interactive
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --device resq-node-01 --skip-calibration
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --device resq-node-01 --skip-session
```

Destructive reset/unpair tests are skipped by default. To run them, use both
interactive mode and the explicit opt-in:

```powershell
python test_files/scripts/resq_mqtt_test_runner.py --interactive --no-skip-destructive
```

The runner subscribes to:

- `resq/manikins/<device_id>/status`
- `resq/manikins/<device_id>/heartbeat`
- `resq/manikins/<device_id>/telemetry`
- `resq/manikins/<device_id>/events`

With `--debug`, it also subscribes to:

- `resq/manikins/<device_id>/#`

Commands are published under:

- `resq/manikins/<device_id>/cmd/...`

## Interactive Vs Non-Interactive Tests

Non-interactive mode is safe for automated evidence collection. It runs broker,
device presence, schema, diagnostic, calibration command response, session,
telemetry policy, event, and config checks where the firmware can respond
without user action.

Interactive mode enables tests that need physical sensor action or explicit
operator confirmation, including:

- full-depth calibration capture
- calibration rejection during an active session
- compression feedback event observation
- reset and unpair, only with `--no-skip-destructive`

Hardware-dependent tests are marked `SKIP` unless their prerequisites are
enabled.

## Evidence Outputs

Every run creates or overwrites:

- `test_files/evidence/resq_mqtt_test_report.md`
- `test_files/evidence/resq_mqtt_test_report.json`
- `test_files/evidence/resq_mqtt_messages.jsonl`

The JSON report contains:

- run metadata
- computed PASS/WARN/FAIL/SKIP summary counts
- one detailed result object for every test case
- observed topics
- observed payload shape summaries
- firmware behavior conclusions
- recommended next actions

The summary is computed from the `results` array. No result is counted unless a
matching detailed result object exists.

The JSONL file records every received MQTT message with timestamp, topic, raw
payload, parsed JSON when valid, retain flag, and QoS.

Reports redact common secret fields:

- `wifi_password`
- `auth_token`
- `token`
- `password`

## Result Status Meaning


Examples:

Heartbeat semantics have been tightened to reduce background traffic:

- `heartbeat` = minimal periodic liveness (preferred: `{ "ok": true }`, acceptable: `{ "alive": true, "state": "IDLE" }`).
- Do not include raw sensor values or large diagnostic blocks in periodic heartbeat.
- Detailed health and sensor/debug information are available on-demand via `cmd/diag/health` and are published as `diagnostic_health` events on the `events` topic.

## Manual Publish Helper

For one-off command checks:

```powershell
python test_files/scripts/resq_mqtt_publish.py --broker localhost --device resq-node-01 --suffix "cmd/diag/ping" --json "{ \"commandId\": \"PING-MANUAL\" }"
```

Or publish one of the payload files:

```powershell
python test_files/scripts/resq_mqtt_publish.py --broker localhost --device resq-node-01 --suffix "cmd/calibration/start" --json-file test_files/payloads/calibration-start.json
```

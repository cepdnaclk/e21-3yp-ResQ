# ResQ MQTT Test Implementation

This document explains the test runner and the updated MQTT/firmware test
policy that the runner enforces. The test suite focuses on the MQTT topic
contract, heartbeat/diagnostic split, metric-first telemetry, and the
calibration/session command flows.

## Key expectations (summary)

- Canonical namespace: `resq/manikins/<device_id>/...`
- `status`: state-focused, retained, minimal fields (device identifier, state, session flags)
- `heartbeat`: periodic minimal liveness only (examples: `{ "ok": true }` or `{ "alive": true }`). No detailed sensor data. Heartbeat must not be retained.
- `telemetry`: metric-first, only during active sessions; raw values only under `debugRaw` when enabled. Telemetry is non-retained and must not expose raw sensor fields at top-level.
- `events`: command results, diagnostics, calibration reports, feedback, and faults
- `cmd/diag/health`: diagnostic command responds on `events` with `diagnostic_health` or `health_report`; `debugRaw` optional and only returned when requested. The runner sends both with and without `includeDebugRaw` and validates that raw blobs appear only nested under `debugRaw` when requested.

## Folder structure (quick)

- `test_files/payloads/` — JSON payloads used by the runner
- `test_files/scripts/` — the canonical MQTT test runner and helper scripts
- `test_files/docs/` — this document
- `test_files/evidence/` — generated evidence (reports and message logs)

## Prerequisites

- Python 3
- `paho-mqtt` (`python -m pip install paho-mqtt`)
- An MQTT broker (e.g. Mosquitto)

## Running the runner

Usage examples:

```powershell
python test_files/scripts/resq_mqtt_test_runner.py --help
python test_files/scripts/resq_mqtt_test_runner.py --broker localhost --port 1883 --device resq-node-01
python test_files/scripts/resq_mqtt_test_runner.py --interactive --calibration-profile adult-basic-v1
```

Important CLI options:

- `--broker` (default: `localhost`)
- `--port` (default: `1883`)
- `--device` (default: `resq-node-01`)
- `--timeout` (seconds, default: `10`)
- `--evidence-dir` (default: `test_files/evidence`)
- `--interactive` (enable hardware-assisted tests)
- `--skip-destructive` (default: true — must use `--interactive` and `--no-skip-destructive` to run destructive tests)
- `--skip-session` (skip session tests)
- `--skip-calibration` (skip calibration tests)
- `--debug` (also subscribe to `resq/manikins/<device_id>/#`)
- `--allow-legacy-fields` (relax strict rejection of some legacy fields)
- `--expect-minimal-heartbeat` (treat extra heartbeat fields as stricter failures)
- `--include-debug-raw` (allow tests to expect `debugRaw` in telemetry/diagnostics)
 - `--require-active-session` (Require an active session for session-dependent tests)
 - `--calibration-profile` (default: `adult-basic-v1`)

Destructive tests (reset/unpair) are disabled by default and require both
`--interactive` and opting out of `--skip-destructive` to run.

## Interactive vs non-interactive

- Non-interactive runs are intended for automated CI / smoke checks and will
	mark hardware-dependent steps as `SKIP` unless prerequisites are satisfied. Hardware-dependent tests include full-depth calibration (`TC-042`) and compression-feedback (`TC-072`).
- Interactive mode enables user prompts and tests that require the operator to
	perform compressions or confirm destructive actions.

## Test semantics: PASS / WARN / FAIL / SKIP

- PASS: behavior matches expectations.
- WARN: behavior is acceptable but indicates a compatibility or configuration
	concern (for example, firmware returned an ACK-only where an event is
	preferred, or mixed naming conventions were observed).
- FAIL: broken behavior, malformed payloads, missing responses where one was
	expected, or clear policy violations (e.g., raw sensor fields at top-level in
	telemetry/status when not allowed).
- SKIP: hardware-dependent or explicitly excluded tests; e.g., calibration
	full-depth capture without `--interactive`.

The runner computes summary counts directly from the `results` list — the
report is authoritative and derived from detailed per-test objects.

## Minimal heartbeat and diagnostic policy

- The `heartbeat` topic must carry a minimal liveness object: preferred `{ "ok": true }`, acceptable `{ "alive": true }` or `{ "alive": true, "state": "IDLE" }`.
- Heartbeat must not include top-level raw sensor values (force/hall/current) or large debug blocks; those belong in diagnostic responses on `events`.
- Heartbeat messages MUST NOT be retained; retained heartbeats will fail `TC-023`.
- Use `cmd/diag/health` to retrieve detailed sensor health. The runner tests both the basic health request and a debug request (`includeDebugRaw: true`) to ensure `debugRaw` appears only in diagnostic responses and not as top-level telemetry/status fields. Diagnostic responses are expected on the `events` topic and include `event_type` equal to `diagnostic_health` or `health_report`. The runner also attempts to detect `cmd/diag/health` support in inspected firmware sources and will SKIP related tests if the handler/subscription is not present.

## Telemetry policy

- Telemetry is only emitted during active sessions.
- Telemetry payloads are "metric-first": the runner expects fields such as
	`depthMm`, `rateCpm`, `recoilOk`, `pauseS`, `compressionCount`, `handPlacement`, and `flags`.
- Raw sensor readings (e.g., `force1`, `force2`, `hallRaw`) must not appear as
	top-level fields in normal telemetry; they may appear under `debugRaw` only
	when debug mode is explicitly enabled.

- When `debugRaw` appears it must be a nested object; raw fields MUST NOT be mixed into the telemetry top-level.

## Diagnostic `cmd/diag/health` flow

- Send `{ "commandId": "...", "includeDebugRaw": false }` and expect a
	`diagnostic_health` or `health_report` event on `resq/manikins/<id>/events`.
- When `includeDebugRaw` is `true`, the diagnostic event may include a
	nested `debugRaw` object. The runner verifies that raw values are nested
	under `debugRaw` and not present at top level.

## Evidence files

Each run writes:

- `test_files/evidence/resq_mqtt_test_report.md` — human readable Markdown
- `test_files/evidence/resq_mqtt_test_report.json` — machine-readable JSON
- `test_files/evidence/resq_mqtt_messages.jsonl` — one JSON object per message

Note: summary counts shown in the Markdown report are computed directly from the detailed `results` entries and are not hardcoded.

The JSON report includes:

- `generatedAt`, `broker`, `port`, `device`, `baseTopic`, `cliOptions`
- `summary` (counts derived from `results`)
- `results` (detailed per-test objects containing id, category, name, purpose,
	command topic/payload, expected, actual, status, matched messages, notes, timestamps)
- `observedTopics`, `observedPayloadShapes`, `conclusions`, `recommendedNextActions`

Reports redact common secret fields such as `wifi_password`, `auth_token`,
`token`, and `password`.

## How to interpret the report

- The summary counts are derived from each detailed `results` entry. Review
	per-test details to determine why a test was `WARN`/`FAIL`/`SKIP`.
- `SKIP` entries include the reason (missing interactivity, skipped groups,
	or absent prerequisites).

## Practical notes and recommended next steps

- Start with the broker running locally (Mosquitto) for development tests.
- Run the runner in non-interactive mode to gather basic evidence quickly.
- If calibration or compression-feedback tests are needed, run with
	`--interactive` and follow prompts.

If you'd like, I can run the test runner's `--help` to validate the CLI after
these changes.

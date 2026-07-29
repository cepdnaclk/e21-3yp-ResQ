# Phase 7A deterministic multi-manikin load harness

## Result

Harness implementation and deterministic smoke validation: **PASS**.

Bounded one- and five-device acceptance: **PASS**.

The locked 10/20-device matrix and 60-minute soak remain **PENDING** and are
not represented as complete.

## Components

The harness lives in `code/resq-localhub/scripts/phase7-scaling/`:

- `phase7-load-harness.js` orchestrates the isolated broker, backend,
  simulators, authentication, calibration, sessions, reconnects, restarts,
  measurements, evidence, and acceptance evaluation.
- `phase7-load-core.js` contains deterministic IDs, percentiles, MQTT
  accounting, resource aggregation, and invariant evaluation.
- `phase7_seed_roster.py` creates deterministic synchronized roster fixtures in
  the isolated SQLite database.
- `phase7_db_stats.py` measures database bytes, page count, table rows, growth,
  and writes per second.
- `run-phase7-matrix.ps1` locks the required durations and 1/5/10/20-device
  scale levels.

## Scenarios

| Scenario | Final duration per scale |
| --- | ---: |
| Idle | 600 s |
| Active session | 600 s |
| Mixed state | 900 s |
| Command burst | 60 s |
| Reconnect | 300 s |
| Twenty-device soak | 3600 s minimum |

The matrix runner cannot shorten these final durations. Separate smoke options
exist only for harness bring-up.

## Measurements

Each result records MQTT messages/s and bytes/s; command reply count and
latency; authenticated REST p50/p95/p99 by endpoint; actual SSE update
p50/p95/p99; backend and broker CPU, working set, private bytes, handles, and
threads; active server-side SSE emitters, queue depth, and dropped fanout jobs;
database growth, rows, and writes/s; recovery time; summary correctness; and
all protected-invariant counters.

## Determinism and safety

- Every run uses its own broker configuration and SQLite database.
- Device IDs, users, course, enrollment, and session inputs are reproducible.
- Test-account passwords are generated per process unless supplied through
  `RESQ_PHASE7_ADMIN_PASSWORD` and `RESQ_PHASE7_INSTRUCTOR_PASSWORD`.
- Java and Mosquitto resolve from `PATH` by default and can be overridden with
  `RESQ_PHASE7_JAVA`, `RESQ_PHASE7_MOSQUITTO`, `--java`, and `--mosquitto`.
- The harness waits for retained MQTT status and backend registration before
  issuing calibration or session commands.
- Strict calibration identity is required before a device can become ready.
- The MQTT topic device ID remains authoritative.
- Backend `receivedAt` controls liveness checks.
- A missing metric fails acceptance instead of silently passing.
- Ordinary REST/SSE JSON is recursively checked for `debugRaw`, `rawPayload`,
  and `payloadJson`.
- A read-only SQLite audit counts every device-bearing row, recomputes the
  active profile fingerprint, detects unexpected identity, and proves that
  non-session devices did not create session/session-runtime rows.
- Strict readiness evidence records schema, generation, storage validity,
  recalibration flag, version, and the exact profile hash for every simulator.

## Tool gates

- Node core and harness audit tests: 7/7 passed.
- Simulator contract tests: 20/20 passed.
- Python helper/audit tests: 3/3 passed.
- JavaScript syntax: passed.
- Matrix PowerShell syntax: passed.

Final bounded smoke validation on 2026-07-29:

| Run | Devices/state | Requested | REST p95 | SSE p95 | Backend CPU p95 | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `final-smoke-1` | 1 idle | 10 s | 22.484 ms | 51 ms | 0.627% | PASS |
| `final-smoke-5` | 5 mixed | 15 s | 104.122 ms | 19 ms | 1.954% | PASS |

Both runs completed isolated broker/backend startup and shutdown with zero
crashes, duplicate sessions, cross-device updates, missing command replies,
summary mismatches, invalid identity persistence, or server-side SSE emitter
leaks. The five-device run exercised two active sessions, one sensor stream,
and two idle devices.

The LocalHub `.gitignore` explicitly re-includes this source directory beneath
the repository's general `scripts/*` exclusion.

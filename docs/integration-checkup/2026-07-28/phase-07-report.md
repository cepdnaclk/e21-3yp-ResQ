# Phase 7 scaling validation report

## Status

Phase 7 scaling implementation and bounded cleanup acceptance: **PASS**.

Full Phase 7 production-scale acceptance: **PARTIAL / PENDING**. The locked
10/20-device matrix, 60-minute soak, and one-physical-plus-simulated run were
not executed during repository cleanup and are not claimed as complete.

## Retained implementation

- A deterministic isolated load harness provisions authentication, roster,
  strict calibration identity, firmware simulators, sessions, sensor streams,
  SSE consumers, database audits, and resource measurements.
- SQLite repositories consistently apply foreign-key enforcement, WAL mode,
  synchronous policy, and a bounded busy timeout through one connection helper.
- SSE fan-out uses a bounded executor and exposes active-emitter, queue-depth,
  and dropped-task health metrics.
- MQTT heartbeat processing refreshes live views without weakening topic
  identity or duplicate-state protection.
- The desktop routes are lazy-loaded for a smaller initial application shell.

## Automated verification

| Gate | Result |
| --- | --- |
| LocalHub backend | 265 passed, 0 failed, 0 errors, 0 skipped |
| Desktop one-worker suite | 23 files, 108 passed |
| Desktop typecheck | PASS |
| Desktop production build | PASS |
| Firmware simulator contracts | 20 passed |
| Phase 7 Node tests | 7 passed |
| Phase 7 Python `unittest` tests | 3 passed |

No firmware source remained after classification, so no new firmware build was
required for this cleanup.

## Bounded scaling acceptance

Acceptance targets remained fixed at REST p95 below 300 ms, visible SSE p95
below 500 ms, backend CPU p95 below 70%, and zero protected-invariant failures.

| Run | Topology | Requested | Measured | REST p95 | SSE p95 | Backend CPU p95 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `final-smoke-1` | 1 idle device | 10 s | 12.274 s | 22.484 ms | 51 ms | 0.627% |
| `final-smoke-5` | 2 sessions, 1 sensor stream, 2 idle | 15 s | 20.295 s | 104.122 ms | 19 ms | 1.954% |

Both runs passed with:

- zero crashes and uncaught harness failures;
- zero duplicate sessions and cross-device updates;
- zero missing command replies and summary mismatches;
- zero invalid profile/device identity persistence;
- zero SSE fan-out drops, queued jobs, and emitters after disconnect;
- clean simulator, broker, and backend shutdown.

The earlier retry JSON, generated databases, WAL/SHM files, broker
configuration, runtime logs, and hostname-bearing XML wrappers were removed.
The measurements above are the concise durable record for the accepted bounded
runs.

## Remaining Phase 7 gates

1. Execute the locked 10- and 20-device matrix durations.
2. Execute the twenty-device soak for at least 60 minutes.
3. Execute the mixed physical-manikin plus simulator topology.

These are remaining validation activities, not failures in the retained
bounded implementation.

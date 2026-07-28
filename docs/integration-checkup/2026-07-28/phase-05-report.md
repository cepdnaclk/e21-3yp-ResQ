# Phase 5 report — Firmware MQTT payload reduction and command reliability

Date: 2026-07-28

Branch: `integration/firmware-localhub-traffic-scaling`

Starting HEAD: `8ef24cc4e21409194d41128c6c2784023725b90b`

## Outcome

Phase 5 implementation is complete and stops before Phase 6. Firmware and simulator now publish the locked minimal/compatible shapes, separate ordinary metrics from diagnostic traffic, derive flags from one normalized metric snapshot, correlate command results, and suppress/replay duplicate requests without repeating transitions.

The largest measured scaling improvement is idle traffic: 12,342 to 1,511.5 bytes/min/device in the simulator (87.75% reduction), with zero duplicate status packets. Session and SENSOR_STREAM traffic did not shrink against the Phase 3 simulator baseline; the reasons and P1 follow-ups are recorded below.

## Commits

| Subphase | Commit |
| --- | --- |
| 5A status contract | `2d86ba9 refactor(firmware): minimize and deduplicate retained status` |
| 5B heartbeat | `9d4f17f refactor(firmware): minimize heartbeat and configure cadence` |
| 5C session metrics | `aa5906b refactor(firmware): publish minimal consistent session metrics` |
| 5D diagnostics | `d132c8a refactor(firmware): isolate debug calibration and sensor-stream traffic` |
| 5E commands | `1f4d494 fix(firmware): correlate and deduplicate mqtt commands` |
| 5F evidence | `test(integration): record phase 5 mqtt traffic reduction` |

## Contract results

- Canonical outgoing namespace only: `resq/{deviceId}/...`.
- Status: minimal, QoS 1, retained, effective-content deduplication, forced reconnect refresh.
- Heartbeat: six fields, one configurable 5000 ms default, stable schedule, disconnected suppression.
- Session: no raw acquisition diagnostics; active session ID, MQTT, owner, state, and publisher gates all required.
- Flags: one derivation function from normalized booleans/conditions.
- Pressure: bounded centeredness score, synchronized threshold 88, canonical and deprecated alias identical.
- Diagnostics: one-shot debug, explicit SENSOR_STREAM, separate calibration events.
- Commands: 9/9 supported command topics correlated; bounded volatile cache and replay.
- LocalHub runtime: unchanged; only fixture/test compatibility updates.

## Regression evidence

| Gate | Result |
| --- | --- |
| Firmware production `fullclean`, build, size | PASS — `0x11a920`, 41% app partition free; total image 1,157,286 bytes |
| Firmware Unity `fullclean`, build | PASS — `0x65de0`, 79% app partition free |
| Firmware Unity execution | BLOCKED — no confirmed serial port/hardware attached |
| LocalHub backend | PASS — 228 tests, 0 failures/errors/skips |
| Desktop typecheck | PASS |
| Desktop tests | PASS — 100 tests in 22 files |
| Desktop production build | PASS — Vite build completed; existing chunk-size warnings only |
| Simulator contract | PASS — 19 tests |
| Simulator syntax | PASS — simulator, contract test, and capture runner |
| Traffic windows | PASS — idle 120 s, stream 60 s, full calibration, session 120 s |
| Duplicate status | PASS — 0 in every Phase 5 capture |

Production binary moved from the Phase 4/early Phase 5 range near `0x11b6f0` to `0x11a920`; the final image retains 41% partition headroom.

## Traffic summary

| Mode | Phase 3 bytes/min | Phase 5 bytes/min | Reduction |
| --- | ---: | ---: | ---: |
| Idle | 12,342 | 1,511.5 | **87.75%** |
| Manual stream | 121,297 | 158,587 | -30.74% |
| Active session | 84,704 | 116,078 | -37.04% |

Payload-only changes: heartbeat 206.27 → 120.00 bytes (-41.82%); idle status 138 → 143 bytes (+3.62%); session telemetry 358.25 → 394.77 bytes (+10.19%); calibration events 145.17 → 138.92 bytes (-4.31%).

The stream increase comes from explicit raw-plus-converted diagnostic fields. The session increase comes from Phase 4-required `depth_mm`, authoritative `recoil_ok`, and the new pressure score field; its measured traffic also reflects a sustained 4.825 Hz versus the Phase 3 window’s 3.358 Hz.

## Command reliability

- Firmware cache: eight entries; completed TTL five minutes; pending recovery two minutes; cleared on boot.
- Simulator cache: 32 entries; completed TTL five minutes; cleared on process start.
- Required duplicate cases covered: session start/stop, calibration start/cancel, stream start/stop, debug and system retry.
- Reset and flush-config are exercised only through the simulator/handler abstraction; no unsafe real reset was invoked.
- Missing identifiers never execute. Firmware logs/rejects because a correlated NACK is technically impossible without an ID; simulator emits `REQUEST_ID_REQUIRED`.

## Findings

| ID | Priority | Area | Finding | Evidence | Resolution/next phase |
| -- | -------- | ---- | ------- | -------- | --------------------- |
| P5-01 | P1 | Session traffic | Locked compatibility fields make session payload 10.19% larger than the already-lean Phase 3 simulator sample; the final window also ran at a higher sustained effective rate. | `phase-05-session-120s.json`, Phase 3 metrics | Hardware/live-UI cadence study; Phase 6 discriminator migration can remove `state`, then remove pressure alias after compatibility window. |
| P5-02 | P1 | Diagnostic traffic | SENSOR_STREAM payload is 45.64% larger after adding explicitly requested raw channels alongside converted compatibility fields. | `phase-05-sensor-stream-60s.json` | Keep opt-in/bounded; Phase 6 consumer audit should decide whether clients can request raw vs converted subsets. |
| P5-03 | P1 | Hardware gate | Production and Unity images compile, but Unity tests were not executed on an ESP32-C3 because no serial port was detected. | empty `SerialPort.GetPortNames()` result | Flash/monitor on a confirmed board and archive Unity output and real MQTT captures. |
| P5-04 | P2 | Build environment | Codex desktop exposed duplicate `PATH`/`Path` variables; a fresh ESP-IDF configure required environment normalization and unsandboxed toolchain path access. | clean-build logs during Phase 5F | Environment-only; no product change required. |

No P0 findings were found.

## Phase 6 boundary

Phase 6 should validate/migrate LocalHub runtime behavior before:

1. accepting `telemetry_mode=SESSION_ACTIVE` and removing session `state`;
2. removing `pressure_balance_pct`;
3. narrowing SENSOR_STREAM to requested raw/converted subsets;
4. changing public DTOs, `debugRaw`, persistence ordering, legacy topics, or stale/offline logic;
5. setting production session cadence from real-device and UI-latency evidence.

No Phase 6 runtime changes are included in this phase.

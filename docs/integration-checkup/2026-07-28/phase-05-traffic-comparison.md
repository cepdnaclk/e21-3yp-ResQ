# Phase 5 MQTT traffic comparison

These are local simulator measurements, not production-hardware limits. Device `M01`, heartbeat default 5000 ms after Phase 5, and telemetry interval 200 ms were used. Phase 3 had a 1000 ms heartbeat. A negative reduction means traffic increased.

## Mode comparison

| Mode/topic | Before msg/s | After msg/s | Before avg bytes | After avg bytes | Byte reduction |
| ---------- | -----------: | ----------: | ---------------: | --------------: | -------------: |
| Idle, all outgoing | 1.000 | 0.208 | 205.70 | 120.92 | **87.75%** |
| Idle heartbeat | 0.992 | 0.200 | 206.27 | 120.00 | **88.27%** |
| Idle status payload | 0.008 | 0.008 | 138.00 | 143.00 | -3.62% |
| Manual stream, all captured | 5.917 | 5.083 | 341.68 | 519.96 | -30.74% |
| Manual stream telemetry | 4.850 | 4.817 | 372.29 | 542.19 | -44.64% |
| Calibration events, full event sequence | 0.100¹ | 2.400² | 145.17 | 138.92 | **4.31% payload** |
| Active session, all captured | 4.317 | 5.067 | 327.04 | 381.84 | -37.04% |
| Active session telemetry | 3.358 | 4.825 | 358.25 | 394.77 | -58.32% traffic / -10.19% payload |

¹ Phase 3 held a completed calibration window open for 120 seconds.

² Phase 5 measured the complete 12-event calibration sequence in a bounded five-second run. Event payload size and full-sequence bytes are comparable; normalized msg/s is not.

## Phase 5 captures

| Window | Messages | Bytes/min | Duplicate status | Evidence |
| --- | ---: | ---: | ---: | --- |
| Idle 120 s | 25 | 1,511.5 | 0 | `phase-05-idle-120s.json` |
| Manual sensor stream 60 s | 305 | 158,587 | 0 | `phase-05-sensor-stream-60s.json` |
| Calibration full run, 5 s | 18 | 28,536 normalized | 0 | `phase-05-calibration-full.json` |
| Active session 120 s | 608 | 116,078 | 0 | `phase-05-session-120s.json` |

## Interpretation

- Idle scaling improved substantially: heartbeat payload shrank 41.82%, cadence fell from about 1 Hz to 0.2 Hz, and unchanged status duplicates are zero.
- Status is five bytes larger than the old idle sample because Phase 4 requires `boot_id` and `state_seq`; it removes `ip` and gains deterministic reconnect/state ordering.
- SENSOR_STREAM is intentionally larger because it now carries the explicitly requested raw channels alongside current converted compatibility fields. It remains opt-in and bounded, so it does not affect idle traffic.
- The Phase 3 session sample was already lean and omitted Phase 4-required `depth_mm`, authoritative `recoil_ok`, and `pressure_balance_score_pct`. Adding those fields makes the average Phase 5 session payload 10.19% larger even after simulator precision was aligned with the production formatter.
- The Phase 5 session window sustained the configured 200 ms interval for almost the whole 120 seconds, while the Phase 3 window averaged only 3.358 Hz. That cadence difference raises measured session bytes/min by 58.32% at the telemetry topic.

## Scaling conclusion

Phase 5 achieves the critical continuous-idle reduction and eliminates duplicate retained status. It does not establish a session or diagnostic traffic reduction against the Phase 3 simulator baseline. Those are recorded as P1 follow-ups: decide a safe production session cadence from hardware/live-UI testing, then remove the session `state` and pressure alias only after Phase 6 LocalHub migration.

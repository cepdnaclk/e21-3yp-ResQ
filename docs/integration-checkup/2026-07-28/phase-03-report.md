# Phase 3 — Baseline MQTT Traffic and Payload Sizes

## 1. Scope

Measured before-change MQTT message rates and UTF-8 payload sizes for one simulated device in four independent windows: 120 seconds idle, 60 seconds manual sensor stream, 120 seconds calibration, and 120 seconds active session. Also measured authenticated baseline response sizes for the health, live-manikin, and sessions APIs.

## 2. Baseline

- Branch: `integration/firmware-localhub-traffic-scaling`
- Starting commit: `a161d04`
- Ending commit: this report's containing commit
- Firmware version: LocalHub firmware simulator at the starting commit
- LocalHub version: `0.1.1`
- Device ID: `M01`
- Hardware or simulator: simulator, one device
- MQTT broker: Mosquitto 2.1.2 on `127.0.0.1:1883`
- Backend URL: `http://127.0.0.1:18080`
- Frontend URL: `http://127.0.0.1:1420`
- Simulator heartbeat interval: 1,000 ms
- Simulator telemetry interval: 200 ms

## 3. Commands Executed

```powershell
mosquitto -c code\resq-localhub\infra\mosquitto\mosquitto.conf -v

Set-Location code\resq-localhub\services\hub-api
$env:RESQ_CLOUD_SYNC_ENABLED = "false"
$env:RESQ_ROSTER_SYNC_ENABLED = "false"
.\mvnw.cmd spring-boot:run

Set-Location code\resq-localhub\apps\localhub-desktop
pnpm.cmd dev --host 127.0.0.1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File docs\integration-checkup\2026-07-28\phase-03-capture.ps1
```

The harness used `mosquitto_sub -t resq/# -v`, file-backed UTF-8 `mosquitto_pub` command payloads, source-controlled analysis logic, and isolated LocalHub storage. A local first-run admin was created only in that isolated database so protected API response bodies could be measured. The database and transient PID files were removed after all exact service process trees were stopped.

## 4. Files Changed

| File | Change | Reason |
| ---- | ------ | ------ |
| `phase-03-capture.ps1` | Added | Reproducible local service capture and metric-analysis harness. |
| `phase-03-*-120s.log`, `phase-03-sensor-stream-60s.log` | Added | Raw topic/payload captures for the four windows. |
| `phase-03-*-metrics.txt`, `phase-03-mqtt-metrics.json` | Added | Per-topic count, rate, byte rate, average size, and unique-payload evidence. |
| `phase-03-health.json` | Added | Backend and broker readiness evidence. |
| `phase-03-api-size-baseline.txt` | Added | Authenticated public API response-size evidence. |
| Service/simulator logs | Added | Preserve broker, backend, frontend, and simulator execution evidence. |
| `phase-03-report.md` | Added | Interpret the measured baseline and limitations. |

No firmware, backend, desktop, broker configuration, or simulator runtime source was changed.

## 5. Test Results

| Test | Expected | Actual | PASS/FAIL/BLOCKED |
| ---- | -------- | ------ | ----------------- |
| Service readiness | Broker and backend connected; API healthy | Health `ok=true`, `mqtt_connected=true`; frontend started on 1420 | PASS |
| Idle 120-second capture | Stable idle sample | 119 heartbeats and one retained status | PASS |
| Manual stream 60-second capture | Telemetry near configured 5 Hz | 291 telemetry messages, 4.85/s | PASS |
| Calibration 120-second capture | Command, progress, result, and status visible | 12 calibration events, four status messages, 115 heartbeats | PASS |
| Active session 120-second capture | Session command/event plus telemetry visible | 403 telemetry messages, 3.358/s; command/event/status captured | PASS WITH FOLLOW-UP |
| Payload-size analysis | Per-topic average and byte rate | Produced for every observed topic/window | PASS |
| Duplicate status analysis | Distinguish retained delivery from repeated publish | Idle had one retained status; transitions were unique; no periodic unchanged status publish observed | PASS |
| Protected API sizes | Successful authenticated responses | Health 277 B; manikins live 1,138 B; sessions 2 B | PASS |
| Cleanup | Only exact launched services stopped | Backend, broker, and frontend process trees stopped; isolated DB removed | PASS |

## 6. Traffic Measurements

### Idle, one device

| Topic | Messages/min | Average payload bytes | Payload bytes/min |
| ----- | -----------: | --------------------: | ----------------: |
| `resq/M01/heartbeat` | 59.5 | 206.27 | 12,273 |
| `resq/M01/status` | 0.5 | 138.00 | 69 |

Idle traffic is therefore dominated by the 1 Hz heartbeat. The single status message is the retained snapshot delivered to the new capture subscriber, not evidence of a fresh periodic publish.

### Manual sensor stream

| Topic | Messages/min | Average payload bytes | Payload bytes/min |
| ----- | -----------: | --------------------: | ----------------: |
| `resq/M01/telemetry` | 291 | 372.29 | 108,336 |
| `resq/M01/heartbeat` | 60 | 205.02 | 12,301 |
| `resq/M01/status` | 3 | 139.00 | 417 |
| `resq/M01/events` | 1 | 139.00 | 139 |
| `resq/M01/cmd/telemetry` | 1 | 104.00 | 104 |

The stream achieved 4.85 messages/s against the configured 5 messages/s. Telemetry accounted for 89% of observed payload bytes in this window.

### Calibration

| Topic | Messages/min | Average payload bytes | Payload bytes/min |
| ----- | -----------: | --------------------: | ----------------: |
| `resq/M01/heartbeat` | 57.5 | 212.36 | 12,210.5 |
| `resq/M01/events/calibration` | 6 | 145.17 | 871 |
| `resq/M01/status` | 2 | 141.00 | 282 |
| `resq/M01/cmd/calibration/start` | 0.5 | 185.00 | 92.5 |

All 12 calibration ACK/progress/final messages occurred near the beginning of the 120-second window. The simulator's calibration event payloads are deliberately compact and do not represent the much larger production calibration evidence payload documented in Phase 2.

### Active session

| Topic | Messages/min | Average payload bytes | Payload bytes/min |
| ----- | -----------: | --------------------: | ----------------: |
| `resq/M01/telemetry` | 201.5 | 358.25 | 72,187.5 |
| `resq/M01/heartbeat` | 55 | 220.85 | 12,147 |
| `resq/M01/status` | 1.5 | 148.67 | 223 |
| `resq/M01/events` | 0.5 | 170.00 | 85 |
| `resq/M01/cmd/session/start` | 0.5 | 123.00 | 61.5 |

The simulator session payload contains no `pressure_*_raw` or `hall_raw` fields, so measured raw-sensor bytes during ordinary simulated sessions were zero. Production firmware source likewise avoids raw counts in its normal session payload, but it includes numerous sensor acquisition/quality diagnostics that this simulator does not model.

The active rate was 3.358/s rather than the configured 5/s while the backend was also persisting and logging messages rejected from domain session processing. The direct MQTT command deliberately bypassed backend session creation, so this window is suitable for broker byte/rate measurement but not LocalHub session-acceptance validation.

### Authenticated API response size

| Endpoint | Status | UTF-8 bytes |
| -------- | -----: | ----------: |
| `/api/hub/health` | 200 | 277 |
| `/api/manikins/live` | 200 | 1,138 |
| `/api/sessions` | 200 | 2 |

## 7. Findings

| ID | Priority | Area | Finding | Evidence | Proposed action |
| -- | -------- | ---- | ------- | -------- | --------------- |
| P3-F01 | P1 | Idle traffic | A 1 Hz, 206-byte average heartbeat costs about 12.3 KB/min/device before MQTT framing. At 20 devices this is roughly 245 KB/min of payload while idle. | Idle metrics | Test a slower heartbeat and minimal fields in Phases 4-5 while preserving the 12-second stale threshold. |
| P3-F02 | P1 | Sensor stream | Manual telemetry costs about 108.3 KB/min/device at 4.85 Hz, excluding MQTT/TCP overhead. | Sensor-stream metrics | Keep the stream explicitly opt-in, stop it reliably, and minimize diagnostic fields. |
| P3-F03 | P1 | Persistence path | Canonical telemetry is persisted before binding validation; a stream that is invalid for the active-session domain can still create storage and logging work. | Backend log plus Phase 2 source trace | Add contract tests and measure database writes before filtering or reordering persistence. |
| P3-F04 | P2 | Active telemetry | Under concurrent backend persistence/logging, the simulator delivered only 3.358/s of the requested 5 Hz. | Active-session metrics | Repeat through a backend-created session and under 1/5/10/20-device load; record CPU, queueing, and accepted count. |
| P3-F05 | P2 | Status retention | No periodic unchanged status publishes were observed. New subscribers receive the retained snapshot, which can look like a duplicate across separate windows. | All raw captures and unique-payload counts | Preserve retained status; deduplicate only by boot/sequence at domain mutation boundaries. |
| P3-F06 | P2 | Calibration sizing | Simulator calibration events averaged 145 B, but production source carries coefficients, masks, and evidence fields and will be substantially larger. | Calibration metrics and Phase 2 matrix | Capture real firmware calibration in Phase 10 before setting final byte budgets. |
| P3-F07 | P2 | API baseline | One live-manikin response is 1,138 B, while an empty sessions response is 2 B. | API size baseline | Re-measure with 5/10/20 live devices and populated session history in Phase 9. |
| P3-F08 | P2 | Harness robustness | Native `-m` argument quoting initially stripped JSON quotes; file-backed publication fixed the command contract. A startup wait was required so non-retained commands were not sent before simulator subscription. | Capture harness and corrected raw logs | Keep file-backed UTF-8 publication and readiness delay in future automated captures. |

## 8. Regressions

No runtime source changed. The final valid captures show successful manual telemetry ACK, calibration ACK/progress/result, and session start event publication. The direct-MQTT session telemetry was expectedly rejected by LocalHub domain binding because no backend session was created; this is a test-path limitation, not a newly introduced regression.

## 9. Decisions Required

| Question | Options | Recommendation | Owner |
| -------- | ------- | -------------- | ----- |
| Idle heartbeat target | Keep 1 Hz; reduce frequency; adaptive frequency | Begin with 5-second idle heartbeat, retain 1-second only during active recovery if needed, and align stale timeout tests | Firmware/LocalHub team |
| Telemetry target | Fixed 5 Hz; state-adaptive; UI-requested | Keep CPR session telemetry near 5 Hz only when active and sensor telemetry strictly command-controlled | Firmware team |
| Canonical persistence | Persist all telemetry; validate first; sample/store summaries | Validate binding before generic persistence and store session summaries/diagnostics intentionally, after Phase 4 tests lock behavior | LocalHub team |
| Production byte budgets | Use simulator figures; wait for real hardware | Use simulator figures as comparative baseline only; set final budgets from production firmware captures | Verification owner |

## 10. Known Limitations

- The firmware simulator payloads are smaller and simpler than production firmware payloads, especially calibration and session diagnostics.
- MQTT/TCP packet overhead, retransmissions, TLS, and Wi-Fi airtime are not included; all byte figures are UTF-8 payload bytes.
- The active-session command was sent directly over MQTT, bypassing LocalHub's persisted session-start workflow, so backend acceptance and SSE session delivery were not measured here.
- The host was simultaneously persisting and logging rejected direct-session telemetry, which depressed the active simulator rate.
- Only one simulated device was measured. Scaling begins in Phase 9.
- The raw capture cannot substitute for hardware sensor timing, RSSI variability, or real calibration duration.

## 11. Acceptance Decision

- [ ] PASS
- [x] PASS WITH FOLLOW-UP
- [ ] FAIL
- [ ] BLOCKED

Reason: all four required windows, per-topic rates/sizes, unchanged-status analysis, raw-field observation, calibration sizing, and authenticated API sizes are recorded. Production firmware and backend-created active-session measurements remain mandatory follow-ups before optimization conclusions are final.

## 12. Commit

- Commit: this report's containing commit
- Message: `test(mqtt): record baseline message rates and payload sizes`
- Rollback point: `a161d04`

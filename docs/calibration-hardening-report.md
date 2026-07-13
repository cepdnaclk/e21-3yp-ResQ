# Calibration Hardening Report

## Root Causes Found

1. `hall_delta` was parsed as a single averaged raw ADC-count delta but rejected values above `4095`, while LocalHub commonly sends the accumulated value from the firmware's 20-sample Hall averaging window.
2. Optional and Hall-only calibration could still enter pressure target waits, causing disconnected or saturated HX710 channels to delay Hall calibration.
3. Pressure target waits used manual delay accounting instead of absolute monotonic deadlines, so blocking sensor reads stretched configured timeouts.
4. Optional pressure fallback sometimes substituted host target pressure values when no genuine stable pressure sample existed.
5. Calibration cancellation only cleared `s_running`; callers could publish `PAIRED_IDLE` before the calibration task released sensor ownership.
6. MQTT command ingestion subscribed at QoS 0 and copied each DATA event as a complete payload, which broke fragmented commands and silently truncated oversized JSON.
7. Session start checked calibration readiness but did not enforce that the requested session profile matched the saved calibration profile.
8. Calibration STARTED was published before `calibration_manager_start()` had successfully acquired ownership and created a running task.

## Files Changed

- `code/resq-firmware/components/calibration_manager/include/calibration_manager.h`
- `code/resq-firmware/components/calibration_manager/calibration_manager.c`
- `code/resq-firmware/components/calibration_manager/test/test_calibration_codes.c`
- `code/resq-firmware/components/calibration_state_manager/calibration_state_manager.c`
- `code/resq-firmware/components/config/resq_config_types.c`
- `code/resq-firmware/components/mqtt_manager/mqtt_manager.c`
- `code/resq-firmware/components/paired_idle_manager/paired_idle_manager.c`
- `code/resq-firmware/components/session_active_manager/session_active_manager.c`
- `code/resq-firmware/README.md`
- `docs/calibration-hardening-report.md`

## Hall Unit Decision

Firmware canonicalizes `hall_delta` to `hall_delta_adc_counts`: absolute movement from the captured Hall baseline in averaged raw ADC counts. If LocalHub sends an accumulated 20-sample value, firmware converts it once at parse time by dividing by the same Hall averaging sample count. Unsupported values are rejected with `CAL_REASON_INVALID_HALL_DELTA`; no clamping is used.

## Pressure-Mode Behavior

`REQUIRED` requires valid positive pressure targets and valid pressure sensors. `OPTIONAL` attempts pressure only when targets and sensors remain usable, then degrades to Hall-only behavior without fabricating measurements. `HALL_ONLY` skips pressure rest health, target waits, and HX710 reads in full-press sampling.

## Timeout Strategy

Pressure target waits now calculate an absolute `esp_timer_get_time()` deadline before the loop. Sensor read time counts against the timeout automatically. Optional-pressure read failures return after a bounded consecutive-failure count instead of waiting for all pressure stages.

## Cancellation Synchronization Design

`calibration_manager` owns a FreeRTOS event group. The calibration task signals `TASK_RUNNING` after entry and always signals `TASK_DONE` after clearing task state and releasing `SENSOR_OWNER_CALIBRATION`. `calibration_manager_cancel()` requests cancellation, wakes the task, and waits for `TASK_DONE` before returning.

## Sensor Ownership Lifecycle

Calibration startup acquires `SENSOR_OWNER_CALIBRATION` before task creation. Startup failure releases ownership immediately. Task exit releases ownership before `TASK_DONE`. State managers publish idle cancellation only after cancel cleanup succeeds.

## Reason-ID Alignment

Existing calibration reason IDs and 5-character event reason strings are preserved. Invalid Hall delta, invalid payload, pressure timeout, saturation fallback, NVS failure, and cancellation continue to use the existing `calibration_codes` mappings.

## MQTT Fragmentation Handling

The MQTT manager now subscribes to the command wildcard with QoS 1, reassembles command payloads using `total_data_len` and `current_data_offset`, accepts empty-topic continuation fragments after the first fragment, rejects oversized payloads, resets partial buffers on disconnect/error/malformed fragments, and queues commands only after a complete payload is assembled. Duplicate QoS 1 calibration-start requests with the same `request_id` are acknowledged as already handled while a calibration is running, without creating a second task.

## Tests Added

- Parser accepts averaged Hall deltas directly and accumulated Hall deltas only when `hall_delta_sample_count` is explicit.
- Parser accepts the preferred `hall_delta_sum` plus `hall_delta_sample_count` contract.
- Parser accepts Hall-only calibration without pressure targets.
- Parser rejects unsupported pressure mode.
- Parser rejects invalid timing values.
- Config validation allows Hall-only calibration without pressure fields while keeping required-pressure mode strict.
- Profile matching is tested through one canonical helper used by both session gates.
- MQTT fragmented command reassembly is tested, including empty-topic continuation fragments, malformed offsets, oversized payload rejection, and single queue delivery.

## Still Requiring Hardware or Deeper Harness Coverage

- Hall-only runtime calibration with HX710 call counters.
- Slow blocking sensor-driver read timeout behavior.
- Cancellation while blocked in each physical sensor stage and while saving NVS.
- NVS commit-failure injection confirming no PASS or READY publication.
- Physical Hall calibration and optional-pressure saturation fallback runs.

## Build/Test Results

Production build passed:

```text
powershell -ExecutionPolicy Bypass -NoProfile -Command ". 'C:\esp\v6.0\esp-idf\export.ps1'; `$env:IDF_CCACHE_ENABLE='0'; python 'C:\esp\v6.0\esp-idf\tools\idf.py' -DCCACHE_ENABLE=0 build"
Result: PASS. Generated build/resq-firmware.bin.
```

Unity test app build was attempted but did not reach project compilation:

```text
powershell -ExecutionPolicy Bypass -NoProfile -Command ". 'C:\esp\v6.0\esp-idf\export.ps1'; `$env:IDF_CCACHE_ENABLE='0'; python 'C:\esp\v6.0\esp-idf\tools\idf.py' -B build-codex -DCCACHE_ENABLE=0 build"
Result: BLOCKED. Existing test build dir was configured with a different Python environment; fresh build dirs failed CMake configure because Ninja/toolchain were not found on PATH in that test project environment.
```

Static searches:

```text
rg -n 'elapsed_ms \+=' components main -S
Result: PASS, no fake elapsed accumulation remains in calibration loops.

rg -n 'CALIBRATION_FULL_PRESS_RATIO_PCT' components main -S
Result: PASS, old 60% full-press acceptance constant removed.

rg -n 'payload too long' components main -S
Result: PASS, old MQTT truncation log/path removed.

rg -n 'esp_mqtt_client_subscribe' components main -S
Result: PASS, command wildcard subscribes with QoS 1.
```

## Remaining Hardware-Dependent Risks

The HX710 bounded-read behavior still depends on real DOUT timing and wiring. Hall direction detection, full-press tolerance, cancellation during a physical blocked read, pressure saturation fallback, and NVS persistence must be validated on ESP32-C3 hardware with the actual sensors installed.

## Hardware Verification Procedure

1. Run normal automatic calibration with healthy Hall and all three HX710 channels.
2. Run Hall-only calibration with all pressure sensors disconnected and confirm pressure target waits are skipped.
3. Disconnect one pressure sensor in required-pressure mode and confirm failure within the configured real timeout.
4. Saturate a pressure channel in optional mode and confirm Hall calibration can pass with degraded pressure fields.
5. Disconnect the Hall sensor and confirm Hall baseline/full-press failure.
6. Perform incomplete full press and confirm no false PASS.
7. Perform incomplete recoil after full press and confirm validation failure.
8. Cancel during rest health, pressure wait, baseline capture, full-press wait, and save window; confirm ownership releases before `PAIRED_IDLE`.
9. Stop the MQTT broker during calibration and confirm no PASS is published after interruption.
10. Disconnect the Wi-Fi router during calibration and confirm cleanup and ownership release.
11. Start calibration immediately after cancellation and confirm no `SENSOR_OWNER_BUSY`.
12. Reboot after a successful calibration and confirm NVS restores readiness.
13. Start a session with a matching `profile_id` and confirm success.
14. Start a session with a mismatched `profile_id` and confirm NACK.

GPIO19 remains the HX710 SCK pin. Native USB/JTAG debugging on ESP32-C3 can interfere with that pressure clock path; use the approved external UART-to-TTL debug path during calibration hardware tests.

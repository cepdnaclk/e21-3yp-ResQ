# Pressure Calibration and Calibration-Fail Correction

## Scope

This correction makes a calibration attempt strict and transactional while
preserving the firmware's tolerant pressure behavior during an active CPR
session. It also makes worker completion explicit, routes failed attempts
through the real `CALIBRATION_FAIL` FSM state, and restores all four required
button exits from that state.

Validated base revision: `46453d0` plus the final-audit working-tree
corrections described here.

## Root causes

1. The pressure target window was computed as the larger of 8 percent and five
   times the initial noise. A noisy initial sample could therefore make the
   window wide enough for clearly incorrect pressure values to pass.
2. Pressure target stages could consume fallback evidence instead of requiring
   a fresh, valid primary sample.
3. Optional/legacy pressure policy paths could turn a failed physical-pressure
   calibration into a Hall-only success.
4. The state manager inferred completion from the saved calibration's ready
   flag. A previous known-good calibration could therefore hide the failure of
   the current attempt.
5. Worker completion state, resource release, and state-owner notification were
   spread across exit paths rather than committed by one guarded finalizer.
6. Calibration managers changed the failure indicator directly, allowing the
   UI to look failed without proving that the FSM had entered
   `CALIBRATION_FAIL`.
7. The fail-state loop could wait too long for commands and did not express the
   complete button-to-state mapping as one testable contract.
8. A recalibration attempt invalidated the trusted NVS metadata before the new
   candidate had passed every physical stage, so a failed attempt could make
   the previous known-good record appear untrusted.
9. Concurrent cancel/fail/pass paths could replace an already committed
   terminal result, and the task-start timeout waited while holding the manager
   mutex needed by the worker finalizer.

## Corrected pressure-calibration contract

- Every mode except explicit `HALL_ONLY` requires all three pressure targets.
- Each target uses a fixed 8 percent tolerance, with a minimum raw tolerance of
  100 counts.
- Bounds are evaluated with 64-bit intermediate arithmetic and clamped to the
  signed 32-bit range.
- A target sample must be fresh, have a successful read status, be marked
  valid, be neither saturated nor stale, and not be substituted from the
  last-stable cache.
- A target passes only after three consecutive in-range samples spanning at
  least 250 ms.
- Any rejected or out-of-range sample resets the consecutive hold tracker.
- Target deadlines fail with the channel-specific reason. They cannot advance
  the stage, commit a baseline, or change the policy.
- The baseline batch remains candidate data. An out-of-range fresh sample
  rejects the batch, and candidate data is promoted only after every target,
  baseline, Hall full-press, validation, and persistence step succeeds.
- Starting a new attempt does not invalidate the active NVS calibration.
  Promotion writes and verifies the inactive slot before committing metadata,
  so a failed candidate preserves the previous trusted record.
- `"Pressure targets reached"` is logged only after P0, P1, and P2 all pass.

## Policy and active-session behavior

Calibration policy and runtime health remain separate:

- `HALL_ONLY` is the only policy that skips pressure calibration.
- `PRESSURE_REQUIRED`, `PRESSURE_OPTIONAL`, and the legacy physical-pressure
  mode all require their targets during a new calibration attempt.
- A failed attempt does not rewrite the saved policy or replace the last
  known-good calibration.
- Temporary pressure faults during a CPR session still mark pressure evidence
  unavailable/degraded without ending Hall-based session processing.
- Invalid, saturated, stale, or duplicate pressure frames are excluded from
  pressure-derived placement, balance, and kPa metrics.
- Runtime degradation is not persisted as calibration policy.

## Worker lifecycle

`calibration_finish()` is the single guarded completion path.

1. It accepts only the first terminal result and the first finalization
   request; late pass, fail, and cancel paths cannot replace that result.
2. A still-running result is converted to `INTERNAL_ERROR`.
3. It releases sensor ownership before publishing a stopped worker state.
4. It clears the worker task handle and running flag.
5. It discards uncommitted candidates and restores runtime health from the
   saved known-good policy on non-pass results.
6. It makes the final result visible and signals the completion event.
7. It notifies the captured state-owner task exactly once.

The terminal log includes the result and the
`state_owner_notified`/`resources_released` evidence.

## FSM and fail-state behavior

The state manager reads `calibration_attempt_result_t` after the worker stops:

- `PASS` with a ready saved calibration returns `READY_FOR_SESSION`.
- `CANCELLED` returns `PAIRED_IDLE`.
- `FAIL` or `INTERNAL_ERROR` returns `CALIBRATION_FAIL`.
- A missing or unexpected completion result becomes a controlled
  sensor-stuck/internal failure instead of leaving the FSM in `CALIBRATING`.

Only normal FSM state entry owns the status-indicator transition.

The fail-state button contract is:

| Input | Next state |
|---|---|
| Button 1 short | `CALIBRATING` |
| Button 2 short | `PAIRED_IDLE` |
| Button 1 long | `TURN_OFF` |
| Button 2 long | `RESETTING` |

The fail-state loop checks task notifications and buttons at intervals no
longer than 50 ms.

## Files changed

- `components/calibration_manager/calibration_manager.c`
- `components/calibration_manager/include/calibration_manager.h`
- `components/calibration_manager/test/test_calibration_codes.c`
- `components/config/config_store.c`
- `components/config/include/config_store.h`
- `components/config/test/test_calibration_store.c`
- `components/calibration_state_manager/calibration_state_manager.c`
- `components/calibration_fail_manager/calibration_fail_manager.c`
- `components/calibration_fail_manager/include/calibration_fail_manager.h`
- `components/calibration_fail_manager/test/test_calibration_fail_buttons.c`
- `components/firmware_state_machine/test/test_firmware_state_machine.c`
- `components/system_button_manager/test/test_system_button_mapping.c`
- `CMakeLists.txt`
- `.gitignore`
- `test/CMakeLists.txt`
- `test/pytest_resq_unity.py`
- `docs/testing/pressure-calibration-and-calibration-fail-fix.md`

## Test evidence

The clean Unity image built successfully as
`test/build-final-unity/resq_firmware_unity.bin` (413,520 bytes). The corrected
image was flashed to ESP32-C3 revision 0.4 on COM4 (MAC
`50:78:7d:92:5d:a4`).

The following tag selections passed independently on COM4, with a hard reset
before each selection:

- `[calibration]`: 28 passed
- `[pressure]`: 14 passed
- `[pressure_quality]`: 10 passed
- `[fsm]`: 36 passed
- `[buttons]`: 11 passed
- `[sensor]`: 15 passed
- `[metrics]`: 20 passed
- `[io_mode]`: 26 passed
- `[hx710]`: 22 passed

Fifteen named correction tests were also run separately; every one reported
`1 Tests 0 Failures 0 Ignored`. The host runner now rejects zero-match
name/tag filters and uses the carriage-return-terminated numeric menu command
required by this ESP32-C3 serial console.

The native run-all result was:

```text
231 Tests 0 Failures 0 Ignored
OK
```

Relevant local logs are under
`test/test-results/final-checks/`. This directory is intentionally ignored and
is not part of the firmware commit.

The run-all hardware tail recorded ten of ten successful repeated synchronized
HX710 reads. Each group capture had `captured_mask=0x07`,
`valid_mask=0x07`, `current_transaction=VALID`, and `cleanup=ESP_OK`.
Next-conversion early-ready conditions remained warnings and did not invalidate
the completed transaction.

The clean production build uses ESP-IDF `MINIMAL_BUILD`, completed
successfully, and contains no project test object, Unity library, or CMock
library:

```text
resq-firmware.bin binary size 0x11b810
Smallest app partition 0x1e0000
0xc47f0 bytes (41%) free
```

The production image was flashed back to COM4 with all written-data hashes
verified. Its captured boot log identifies project `resq-firmware`, enters
`BOOT`, `CONFIG_CHECK`, then `PROVISIONING`, and contains no panic, watchdog,
stack-overflow, or corrupt-heap signature.

The boot does retain an existing diagnostic:
`wifi_init: Failed to init, WiFi is initialized by esp_wifi_init`.
Provisioning continues successfully immediately afterward: SoftAP, DHCP, and
the HTTP server all start.

## Hardware validation status

Completed automatically:

- Unity execution on the target ESP32-C3 over COM4.
- Live Hall and three-channel pressure acquisition.
- Repeated synchronized HX710 transactions and shared-SCK cleanup.
- Strict pressure/FSM/button contracts through target-executed Unity tests.

Still requires a user-assisted production calibration session:

- Negative end-to-end calibration with deliberately unreachable MQTT targets,
  including observation of the timeout, terminal worker log, real FSM entry,
  and physical retry/exit buttons.
- Positive calibration while applying and holding the required loads.
- Active-session pressure disconnection/saturation while a CPR session is
  running.

Those scenarios require backend commands and controlled physical input. They
must not be inferred from the raw-sensor diagnostics or pure contract tests.
The current saved production configuration boots in `USB` mode and
`PROVISIONING`; pressure/HX710 initialization is correctly skipped in that
mode. End-to-end calibration validation therefore also requires provisioning
the device and selecting `SENSOR` mode before sending the calibration command.

## Suggested commit

```text
fix(firmware): enforce pressure calibration and recover fail state
```

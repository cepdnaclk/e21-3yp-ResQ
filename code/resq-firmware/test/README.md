# ResQ Firmware Unity Tests

This project builds a separate ESP-IDF Unity image. Deterministic cases do not
connect to Wi-Fi, MQTT, ADC, HX710, Hall ADC, or physical buttons. Cases tagged
`[hardware]` are explicit exceptions and require a board and the corresponding
sensors. Sensor working-condition unit tests continue to use mocked sequences
and pure evaluation helpers.

## Build

Open an ESP-IDF v6.0 shell:

```powershell
cd code\resq-firmware\test
idf.py set-target esp32c3
idf.py build
```

## Flash and run all tests

Install the ESP-IDF pytest packages if they are not already present:

```powershell
python -m pip install pytest pytest-embedded pytest-embedded-serial-esp pytest-embedded-idf
```

Then run:

```powershell
pytest .\pytest_resq_unity.py `
  --embedded-services esp,idf,serial `
  --target esp32c3 `
  --port COM4 `
  --junitxml resq_firmware_unity_junit.xml
```

Pytest drives the Unity serial menu and runs every registered case. Results:

- `resq_firmware_unity_junit.xml`: CI-compatible JUnit report.
- `resq_firmware_unity_report.json`: suite-level JSON summary.

Both files are generated results and should not be committed as evidence unless
they came from an actual test run.

## Raw Sensor Output Test

The `[sensor_raw][hardware]` Unity tests directly read and print raw Hall-effect and
HX710 pressure sensor values from the ESP32-C3 board. These tests do not
classify values, do not calculate CPR metrics, do not run calibration, and do
not decide pass/fail from numeric magnitude. Pressure cases fail when no valid
HX710 read is obtained, after printing the per-channel evidence.

Run this while physically pressing and releasing the CPR manikin chest. The
expected behavior is that the raw values visibly change in the serial output,
but the firmware test will not label those values. Every data line starts with
`RAW_SENSOR`, so the output can be copied into CSV/Excel for plotting.

Build, flash and monitor:

```powershell
cd code\resq-firmware\test
idf.py set-target esp32c3
idf.py build
idf.py flash monitor
```

Pytest/Unity serial runner:

```powershell
pytest .\pytest_resq_unity.py --embedded-services esp,idf,serial --target esp32c3 --port COM4
```

Replace `COM4` with the actual ESP32-C3 serial port.

Example raw output:

```text
RAW_SENSOR,HALL,sample=0,hall_raw=2031
RAW_SENSOR,PRESSURE,sample=0,pressure_1_valid=true,pressure_1_error=ESP_OK,pressure_1_raw=10142,pressure_2_valid=true,pressure_2_error=ESP_OK,pressure_2_raw=10081,pressure_ref_valid=true,pressure_ref_error=ESP_OK,pressure_ref_raw=9920,valid_mask=0x07,group_error=ESP_OK
RAW_SENSOR,ALL,sample=0,hall_raw=2031,pressure_1_valid=false,pressure_1_error=ESP_ERR_TIMEOUT,pressure_2_valid=false,pressure_2_error=ESP_ERR_TIMEOUT,pressure_ref_valid=false,pressure_ref_error=ESP_ERR_TIMEOUT,valid_mask=0x00,group_error=ESP_ERR_TIMEOUT
```

A raw field is present only when its matching `*_valid=true`. A successful raw
zero is therefore printed as valid with `*_raw=0`; a timeout never creates a
measurement field.

## HX710 hardware diagnostics

Use the Unity menu to run
`test_hx710_shared_sck_and_dout_diagnostics` or
`test_hx710_repeated_synchronized_group_reads`. Both are tagged
`[hx710_diag][hardware]`, require the persisted `SENSOR` I/O mode, and acquire
`SENSOR_OWNER_DIAGNOSTIC`. They do not start Wi-Fi, calibration, sessions, or
manual telemetry.

The staged diagnostic prints `HX710_DIAG` records for:

1. Active I/O mode, HX710 ownership, and GPIO6 LOW readback.
2. Each DOUT's initial level without generating a clock.
3. One all-ready-or-no-clock synchronized group transaction.
4. Per-channel readiness, timeout, stuck-HIGH, stuck-LOW, post-read, capture,
   and raw-validity fields. Captured-but-invalid raw values are explicitly
   labeled and never treated as valid.
5. Current-transaction validity separately from the non-fatal
   `next_ready_warning_mask`, including test-only microsecond timing, pulse
   count, readiness time, and error.
6. Final verified GPIO6 LOW and sensor-owner cleanup state.

The repeated test discards three warm-up transactions, then requires ten valid
synchronized, protocol-validated conversions within twenty bounded attempts.
Every successful conversion must use exactly 25 shared clock pulses and leave
GPIO6 LOW. The production read returns after current-transaction validation;
only this hardware test observes the following conversion for timing warnings.
There is no software-selected single-channel isolation test because all
physically connected modules receive every shared SCK edge.

### Hardware procedure

Test A — shared clock only:

1. If practical, disconnect all HX710 DOUT lines.
2. Run the staged diagnostic and measure GPIO6.
3. Confirm approximately 0 V while idle and no unintended pulses during the
   DOUT-observation stage.

Test B — DOUT fault classification:

1. With all modules connected, run the staged diagnostic.
2. Confirm a DOUT that never becomes LOW is reported in `stuck_high_mask` and
   that `pulse_count=0`.
3. Confirm a DOUT that remains LOW in the mandatory immediate post-read check
   is rejected by `post_invalid_mask` and is never logged as a valid raw zero.
   A later early next-ready transition may set `next_ready_warning_mask`, but
   must not invalidate the completed sample.

Test C — shared clock: run the staged group
diagnostic, confirm every readiness bit, and confirm GPIO6 returns LOW after
each transaction.

Test D — repeated conversions: run the repeated synchronized test and confirm
all ten reads pass with `valid_mask=0x07` and `pulses=25`. Record any
next-ready timing warnings separately.

Test E — power stability: repeat before Wi-Fi starts and
with a stable external supply. Record any change in DOUT readiness. Do not
disable brownout protection.

Serial output is observation evidence only. Do not claim the pressure path is
working unless hardware produced successful valid reads. A firmware build
cannot prove measured voltage, physical clock edges, grounding, supply
stability, or changing pressure response.

## Test groups

| Tag | Coverage |
| `[fsm]` | All 16 states, entry behavior, USB-mode sensor-state suppression, recovery and terminal actions |
| `[config]` | Defaults, validation boundaries, state names, I/O-mode NVS persistence and reset behavior |
| `[io_mode]` | Reboot-only mode changes, no-op active-mode requests, USB sensor gating, and fallback behavior |
| `[buttons]` | Short USB/SENSOR mode selection and preserved long TURN_OFF/factory-reset mappings |
| `[error]` | Firmware error code/action mappings |
| `[mqtt]` | Topic construction and request ID parsing |
| `[session]` | Session start, stop, mismatch, interruption and restart |
| `[metrics]` | Compression depth, rate, recoil and hand placement |
| `[sensor]` | Mocked sensor working-condition checks |
| `[pressure]` | Pressure baseline, response, release, stuck, saturated, noise and balance checks |
| `[hall]` | Hall baseline, movement, full-depth, recoil, stuck, saturated and reset math checks |
| `[readiness]` | Combined pressure + Hall readiness gating |
| `[sensor_raw][hardware]` | Direct board raw Hall and validity-aware pressure readings |
| `[hx710]` | Mocked ownership, readiness, shared transactions, current-protocol validation, non-fatal next-ready observations, cleanup, and output validity |
| `[hx710_diag][hardware]` | GPIO6 shared-SCK ownership, DOUT states, synchronized group reads, non-fatal next-conversion timing observations, and cleanup diagnostics |

The `[sensor]`, `[pressure]`, `[hall]` and `[readiness]` Unity cases do not read
GPIO, ADC, HX710, Wi-Fi, MQTT, buttons or long-running FreeRTOS tasks. They
exercise the pressure/Hall/readiness logic with fixed arrays of raw samples.

## Optional sensor smoke/HIL

Real hardware validation is separate from the normal Unity run. Use it only
when an ESP32-C3, ResQ pressure sensors, Hall sensor and CPR manikin hardware
are connected and firmware sensor diagnostic/calibration logging is available.

Manual checklist:

1. Flash firmware to the ESP32-C3.
2. Start a sensor diagnostic or calibration mode.
3. Read pressure raw values at rest and confirm they are stable.
4. Press the bladder/chest and confirm pressure changes clearly.
5. Release and confirm pressure returns near baseline.
6. Read Hall raw value at rest and confirm it is stable.
7. Press the chest and confirm Hall value changes in the expected direction.
8. Release and confirm Hall returns near baseline.
9. Confirm firmware reports pressure OK and Hall OK.
10. If safe for the setup, unplug or invalidate one sensor and confirm the
    firmware reports a fault.

Optional pytest smoke command:

```powershell
$env:RESQ_RUN_SENSOR_HIL = "1"
pytest .\pytest_sensor_smoke_hil.py `
  --embedded-services esp,idf,serial `
  --target esp32c3 `
  --port COM4
```

Do not enable `RESQ_RUN_SENSOR_HIL` in normal CI unless a board and sensors are
explicitly available.

## Troubleshooting

- Use an ESP-IDF v6.0 terminal so `IDF_PATH`, Ninja, CMake and the RISC-V
  toolchain are on `PATH`.
- If the board does not enter download mode, hold `BOOT`, tap `RESET`, begin
  flashing, then release `BOOT`.
- Test firmware is separate from production firmware. Reflash the production
  image before running `../deploy_test/`.
- The deployment suite clean-erases the board, automates provisioning, captures
  serial/MQTT evidence, and guides the remaining physical checks.

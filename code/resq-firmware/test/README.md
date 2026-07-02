# ResQ Firmware Unity Tests

This project builds a separate ESP-IDF Unity image for deterministic firmware
tests. It does not connect to Wi-Fi, MQTT, ADC, HX710, Hall ADC, or physical
buttons. Sensor working-condition tests use mocked sample sequences and pure
evaluation helpers so they can run without real pressure or Hall hardware.
Real board sensor checks are kept in the optional smoke/HIL path below.

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

The `[sensor_raw]` Unity tests directly read and print raw Hall-effect and
HX710 pressure sensor values from the ESP32-C3 board. These tests do not
classify values, do not calculate CPR metrics, do not run calibration, and do
not decide pass/fail from the numeric readings. They only fail if a required
sensor driver init/read API returns an ESP-IDF error.

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
RAW_SENSOR,PRESSURE,sample=0,pressure_1_raw=10142,pressure_2_raw=10088,pressure_ref_raw=9920
RAW_SENSOR,ALL,sample=0,hall_raw=2031,pressure_1_raw=10142,pressure_2_raw=10088,pressure_ref_raw=9920
```

## Test groups

| Tag | Coverage |
|---|---|
| `[fsm]` | All 16 states, entry behavior, buttons, recovery and terminal actions |
| `[config]` | Defaults, validation boundaries, state names |
| `[error]` | Firmware error code/action mappings |
| `[mqtt]` | Topic construction and request ID parsing |
| `[session]` | Session start, stop, mismatch, interruption and restart |
| `[metrics]` | Compression depth, rate, recoil and hand placement |
| `[sensor]` | Mocked sensor working-condition checks |
| `[pressure]` | Pressure baseline, response, release, stuck, saturated, noise and balance checks |
| `[hall]` | Hall baseline, movement, full-depth, recoil, stuck, saturated and reset math checks |
| `[readiness]` | Combined pressure + Hall readiness gating |
| `[sensor_raw]` | Direct board raw Hall and pressure readings printed as CSV-like serial lines |

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

# ResQ Firmware Unity Tests

This project builds a separate ESP-IDF Unity image for deterministic firmware
tests. It does not connect to Wi-Fi, MQTT, ADC, HX710, or physical buttons.
Those paths remain covered by the production deployment qualification package
in `../deploy_test/`.

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

## Test groups

| Tag | Coverage |
|---|---|
| `[fsm]` | All 16 states, entry behavior, buttons, recovery and terminal actions |
| `[config]` | Defaults, validation boundaries, state names |
| `[error]` | Firmware error code/action mappings |
| `[mqtt]` | Topic construction and request ID parsing |
| `[session]` | Session start, stop, mismatch, interruption and restart |
| `[metrics]` | Compression depth, rate, recoil and hand placement |

## Troubleshooting

- Use an ESP-IDF v6.0 terminal so `IDF_PATH`, Ninja, CMake and the RISC-V
  toolchain are on `PATH`.
- If the board does not enter download mode, hold `BOOT`, tap `RESET`, begin
  flashing, then release `BOOT`.
- Test firmware is separate from production firmware. Reflash the production
  image before running `../deploy_test/`.
- The deployment suite clean-erases the board, automates provisioning, captures
  serial/MQTT evidence, and guides the remaining physical checks.

# ResQ Firmware

ResQ firmware runs on an ESP32-C3 inside the ResQ CPR training device. It reads
three HX710 pressure channels and a hall sensor, guides calibration, evaluates
CPR compressions, drives status LEDs and a buzzer, and communicates with the
ResQ backend over Wi-Fi, HTTP, and MQTT.

This is the primary developer guide for building, flashing, provisioning, and
testing the firmware.

## Contents

- [What the firmware does](#what-the-firmware-does)
- [Requirements](#requirements)
- [Hardware connections](#hardware-connections)
- [Build and flash](#build-and-flash)
- [First-boot provisioning](#first-boot-provisioning)
- [Runtime state machine](#runtime-state-machine)
- [MQTT interface](#mqtt-interface)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Important operational notes](#important-operational-notes)
- [Troubleshooting](#troubleshooting)

## What the firmware does

The firmware coordinates the complete device lifecycle:

1. Initializes NVS, sensors, networking, indicators, buttons, session services,
   telemetry, and the firmware state machine.
2. Loads saved network and calibration data from NVS.
3. Starts a provisioning SoftAP when no valid network configuration exists.
4. Connects to Wi-Fi and registers the device with the configured backend.
5. Connects to the MQTT broker returned by registration.
6. Publishes device identity, retained state, and a heartbeat every five
   seconds.
7. Accepts calibration, session, debug, and recovery commands over MQTT.
8. Samples the pressure and hall sensors during a CPR session.
9. Calculates depth progress, compression rate, recoil, hand placement,
   pressure balance, pauses, and validity flags.
10. Publishes live session telemetry and controls the metronome buzzer.
11. Attempts bounded session recovery after Wi-Fi or MQTT interruption.
12. Supports factory reset and a software-managed soft-off state.

The application entrypoint is intentionally small. `main/app_main()` initializes
ESP-IDF services, wires production dependencies into `firmware_state_machine`,
starts the state/indicator services, and repeatedly steps the state machine.

## Requirements

### Firmware development

- ESP32-C3 ResQ hardware
- USB data cable and the appropriate USB-to-UART/JTAG driver
- [ESP-IDF v6.0](https://docs.espressif.com/projects/esp-idf/en/release-v6.0/esp32c3/)
- Python supplied by, or compatible with, the ESP-IDF installation
- Git, CMake, Ninja, and the RISC-V toolchain installed by ESP-IDF
- A PowerShell or ESP-IDF terminal with `IDF_PATH` and the toolchain exported

Verify the environment before building:

```powershell
idf.py --version
```

The output must identify ESP-IDF v6.0. All commands below assume Windows
PowerShell and use `COM4` as an example. Replace it with the board's actual
serial port.

### Hardware qualification

The deployment qualification additionally requires:

- Real connected pressure bladders and hall-sensor chest mechanism
- A known calibration/reference setup
- Mosquitto
- Python 3.11 or newer
- Access to the test Wi-Fi network and its router-control hook

## Hardware connections

The production pin assignment is defined in
`components/config/include/board_config.h`.

| Function | ESP32-C3 pin/channel |
|---|---:|
| HX710 shared clock | GPIO19 |
| Pressure sensor 0 DOUT | GPIO1 |
| Pressure sensor 1 DOUT | GPIO3 |
| Pressure sensor 2 DOUT | GPIO10 |
| Hall sensor | ADC channel 0 |
| State LED | GPIO7 |
| Activity LED | GPIO6 |
| Buzzer | GPIO18 |
| BUTTON_1 | GPIO4 |
| BUTTON_2 | GPIO5 |

All three HX710 devices share one clock line and must be sampled as one
synchronized transaction. Do not rewrite the pressure path to read the devices
sequentially using the shared clock.

## Build and flash

Open an ESP-IDF v6.0 PowerShell:

```powershell
cd code\resq-firmware
idf.py set-target esp32c3
idf.py build
```

`set-target` normally needs to be run only when creating a build directory or
changing targets. The production target is always `esp32c3`.

### Flash production firmware

```powershell
idf.py -p COM4 flash
```

Open the serial monitor:

```powershell
idf.py -p COM4 monitor
```

Build, flash, and monitor in one command:

```powershell
idf.py -p COM4 build flash monitor
```
Exit the ESP-IDF monitor with `Ctrl+]`.

### Clean or erase the device

Rebuild all generated files without erasing NVS:

```powershell
idf.py fullclean
idf.py set-target esp32c3
idf.py build
```

Erase the complete flash, including saved Wi-Fi and calibration data:

```powershell
idf.py -p COM4 erase-flash
```

After an erase, flash production firmware again:

```powershell
idf.py -p COM4 flash monitor
```

### Generated artifacts

The `build/` directory is generated and must not be committed. Important
outputs include:

| Artifact | Purpose |
|---|---|
| `build/resq-firmware.bin` | Production application image |
| `build/resq-firmware.elf` | Executable with symbols for debugging |
| `build/resq-firmware.map` | Linker memory map |
| `build/bootloader/bootloader.bin` | ESP-IDF bootloader |
| `build/partition_table/partition-table.bin` | Compiled partition table |
| `build/flasher_args.json` | Exact images and offsets used for flashing |

Prefer `idf.py flash` over manually invoking `esptool`; it uses the correct
offsets from the active build.

## First-boot provisioning

When no valid network configuration exists, the device enters
`PROVISIONING` and creates:

```text
SSID:     ResQ-<MAC suffix>
Password: resq12345
URL:      http://192.168.4.1
```

Connect a phone or computer to the SoftAP and open the URL. Provisioning
requires:

- Wi-Fi SSID
- Wi-Fi password, which may be empty for an open network
- Backend base URL, for example `http://192.168.8.100:18080`

The HTTP API is:

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/` | Provisioning web page |
| `GET` | `/status` | Provisioning and acknowledgement status |
| `POST` | `/provision` | Submit Wi-Fi and backend configuration |
| `POST` | `/provision/ack` | Confirm the returned `ack_id` and save |

`POST /provision` accepts JSON:

```json
{
  "wifi_ssid": "ResQ-Lab",
  "wifi_pass": "password",
  "backend_base_url": "http://192.168.8.100:18080"
}
```

The device saves the configuration only after the second acknowledgement
request succeeds. It then stops the SoftAP, joins the configured Wi-Fi network,
registers at `<backend_base_url>/api/devices/register`, and uses the returned
device ID, MQTT host, and MQTT port.

Network and valid calibration data persist in NVS across ordinary restarts and
soft-off. A factory reset or `erase-flash` removes them.

## Runtime state machine

The firmware has 16 explicit states:

| State | Purpose |
|---|---|
| `BOOT` | Initialize components and load saved configuration |
| `CONFIG_CHECK` | Select Wi-Fi or provisioning based on valid configuration |
| `PROVISIONING` | Run the SoftAP and two-phase provisioning server |
| `FLUSH_CONFIG` | Stop networking and clear saved network configuration |
| `WIFI_CONNECTING` | Join Wi-Fi and obtain an IP address |
| `BACKEND_REGISTERING` | Register the device and receive broker details |
| `MQTT_CONNECTING` | Connect, publish identity/status, and start heartbeat |
| `PAIRED_IDLE` | Wait for calibration or other valid commands |
| `CALIBRATING` | Collect and validate calibration sensor data |
| `CALIBRATION_FAIL` | Publish failure guidance and allow retry or discard |
| `READY_FOR_SESSION` | Calibrated idle state that accepts session start |
| `SESSION_ACTIVE` | Sample sensors, calculate CPR metrics, and publish telemetry |
| `SESSION_INTERRUPTED` | Recover networking and publish deferred interruption |
| `ERROR` | Publish a reason/action policy and wait for recovery input |
| `RESETTING` | Stop runtime work, clear all NVS data, and restart |
| `TURN_OFF` | Stop runtime work, persist valid data, and enter soft-off |

A normal first-use path is:

```text
BOOT -> CONFIG_CHECK -> PROVISIONING -> WIFI_CONNECTING
-> BACKEND_REGISTERING -> MQTT_CONNECTING -> PAIRED_IDLE
-> CALIBRATING -> READY_FOR_SESSION
-> SESSION_ACTIVE -> READY_FOR_SESSION
```

State changes control the two status LEDs and are also published over MQTT when
the broker is available.

## MQTT interface

All MQTT topics use:

```text
resq/{device_id}/{suffix}
```

### Commands

| Topic suffix | Purpose |
|---|---|
| `cmd/debug` | Publish a raw pressure/hall sensor snapshot |
| `cmd/calibration/start` | Start calibration with reference parameters |
| `cmd/calibration/cancel` | Cancel active calibration |
| `cmd/session/start` | Start a calibrated CPR session |
| `cmd/session/stop` | Stop the active session |
| `cmd/system/retry` | Apply ERROR-state retry policy |
| `cmd/system/reset` | Reset from ERROR according to policy |
| `cmd/system/flush-config` | Clear network configuration from ERROR |

Commands use a non-empty `request_id`. Legacy `command_id` is accepted in a
small number of parsing paths for compatibility, but new clients should send
`request_id`.

There is no MQTT turn-off command. TURN_OFF is owned by BUTTON_1 long press.
The `cmd/system/*` commands are ERROR-state recovery controls, not general
commands for healthy idle states.

### Publications

| Topic suffix | Contents |
|---|---|
| `status` | Retained state, session, calibration, profile, thresholds, and IP |
| `heartbeat` | Connectivity, registration, session, sensor, RSSI, and uptime |
| `telemetry` | Live CPR measurements and quality metrics |
| `debug` | Raw pressure and hall readings |
| `events` | Identity, command replies, and session events |
| `events/calibration` | Calibration progress and terminal result |
| `events/error` | Firmware errors and system-command results |

The heartbeat task publishes every five seconds while MQTT is connected.
Session telemetry is more frequent and is emitted only while a valid session
is active.

## Testing

There are two separate test layers. They use different firmware images and
serve different purposes.

### 1. ESP-IDF Unity component tests

The Unity application under `test/` covers deterministic behavior without
using real Wi-Fi, MQTT transport, ADC, HX710 devices, or buttons. It tests the
state machine, configuration boundaries, error/calibration mappings, topics,
request IDs, session lifecycle, and CPR metrics.

Build the Unity image:

```powershell
cd code\resq-firmware\test
idf.py set-target esp32c3
idf.py build
```

Install the pytest-embedded packages:

```powershell
python -m pip install pytest pytest-embedded pytest-embedded-serial-esp pytest-embedded-idf
```

Flash and run every registered Unity case:

```powershell
pytest .\pytest_resq_unity.py `
  --embedded-services esp,idf,serial `
  --target esp32c3 `
  --port COM4 `
  --junitxml resq_firmware_unity_junit.xml
```

The Unity image replaces production firmware on the board. Reflash from
`code\resq-firmware` before using the device or running deployment
qualification.

See [test/README.md](test/README.md) for test groups, reports, and
troubleshooting.

### 2. Production deployment qualification

The deployment suite under `deploy_test/` builds and clean-flashes production
firmware, provisions the device, runs a mock backend and broker, captures
serial/MQTT evidence, guides real sensor/button checks, tests sessions and
network recovery, and finishes with destructive reset/soft-off checks.

Set up its Python environment:

```powershell
cd code\resq-firmware\deploy_test
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pytest -q
```

Create the ignored local configuration from `config.example.toml`, set the
Wi-Fi password environment variable, and run:

```powershell
Copy-Item config.example.toml config.toml
$env:RESQ_TEST_WIFI_PASSWORD = "test-network-password"
python -m resq_deploy_test run --config config.toml
```

Deployment qualification erases the entire flash and NVS by default. It
requires assembled hardware and operator actions; it cannot be replaced by a
host-only test.

See [deploy_test/README.md](deploy_test/README.md) for prerequisites, router
hooks, evidence files, expected observations, and troubleshooting.

## Project structure

```text
resq-firmware/
|-- CMakeLists.txt            Production ESP-IDF project
|-- partitions.csv            NVS, PHY, and factory-app layout
|-- main/                     Production entrypoint and dependency wiring
|-- components/               Firmware components and component Unity tests
|-- test/                     Separate ESP-IDF Unity test application
|-- deploy_test/              Production hardware qualification package
|-- managed_components/       Generated ESP-IDF managed dependencies
`-- build/                    Generated production build output
```

Major component groups:

- **Orchestration:** `firmware_state_machine`, `paired_idle_manager`,
  `calibration_state_manager`, `calibration_fail_manager`, `error_manager`
- **Configuration:** `config`, NVS storage, state definitions, and board pins
- **Connectivity:** `provisioning_manager`, `wifi_manager`,
  `backend_register_client`, `mqtt_manager`
- **Sensors and metrics:** `adc_shared_service`, `hall_sensor`, `hx710`,
  `calibration_manager`, `cpr_metrics`
- **Session runtime:** `session_manager`, `session_active_manager`,
  `telemetry_publisher`, `buzzer_manager`
- **User feedback:** `runtime` status indicators and `system_button_manager`

## Partition layout

The custom partition table is intentionally simple:

| Name | Type | Offset | Size | Purpose |
|---|---|---:|---:|---|
| `nvs` | data/NVS | `0x9000` | 24 KiB | Network and calibration persistence |
| `phy_init` | data/PHY | `0xF000` | 4 KiB | Wi-Fi PHY initialization data |
| `factory` | app/factory | `0x10000` | `0x1E0000` | Production application |

This table contains one factory application partition and no OTA slots.

## Important operational notes

- **Real sensors are required.** Floating or disconnected HX710/hall inputs
  cannot produce a meaningful calibration or hardware qualification.
- **HX710 timeout sentinel:** `-999999` indicates that a pressure ADC did not
  become ready. Treat it as a wiring, power, clock, or sensor problem.
- **Calibration persistence:** successful calibration is stored in NVS. The
  TURN_OFF path saves calibration only when it is valid.
- **Recovery deadline:** an active session attempts to recover connectivity for
  30 seconds. Once that deadline expires, runtime services stop and a terminal
  session interruption is retained for deferred publication.
- **BUTTON_1:** a long press of at least three seconds requests TURN_OFF in
  normal states. Some internal failure states give short presses specialized
  retry behavior.
- **BUTTON_2:** a long press of at least three seconds requests factory reset
  in normal states. Reset clears network and calibration data before restart.
- **Soft-off is not deep sleep or power isolation.** The current implementation
  stops runtime work and remains in a delay loop. Reset or power-cycle the
  device to start it again.
- **Do not commit secrets or generated state.** Keep Wi-Fi/router credentials,
  `deploy_test/config.toml`, generated evidence, `sdkconfig`, `build/`, and
  managed/generated dependencies out of commits.
- **Do not fabricate reports.** Unity, deployment, and hardware reports must
  represent an actual run. A skipped required deployment check is incomplete,
  not passing.

## Troubleshooting

### `idf.py` is not recognized

Open the ESP-IDF v6.0 terminal or run the ESP-IDF export script. Confirm:

```powershell
$env:IDF_PATH
idf.py --version
```

### Serial port cannot be opened

- Close ESP-IDF monitor, PuTTY, Arduino Serial Monitor, and other serial tools.
- Check Device Manager for the correct COM port.
- Disconnect and reconnect the USB cable.
- Confirm the cable supports data, not charging only.

### Board will not enter download mode

Hold the board's `BOOT` button, tap `RESET`, start the flash operation, and
release `BOOT` when flashing begins. Exact button labels depend on the board.

### Build behaves unexpectedly after source or target changes

```powershell
idf.py fullclean
idf.py set-target esp32c3
idf.py build
```

Do not manually edit generated files under `build/`.

### The `ResQ-` provisioning network is not visible

- Confirm the device was fully erased or has no valid saved configuration.
- Check serial output for `PROVISIONING`.
- Power-cycle the device.
- Confirm Wi-Fi is enabled on the provisioning computer or phone.

### Provisioning succeeds but the device does not connect

- Verify the Wi-Fi SSID and password.
- Ensure the ESP32 and backend host are on a mutually reachable network.
- Use a backend URL containing a LAN-reachable IP, not `localhost`.
- Allow the backend and MQTT ports through the host firewall.
- Inspect serial logs for Wi-Fi, registration, and broker errors.

### MQTT messages are missing

- Confirm backend registration returned a non-empty device ID, MQTT host, and
  MQTT port.
- Subscribe to `resq/#` to inspect all device traffic.
- Verify the broker accepts the firmware connection and the host is reachable.
- Remember that telemetry requires a valid calibration and active session.

### Sensor debug or calibration fails

- Check the shared GPIO19 HX710 clock and all three DOUT connections.
- Check sensor power and common ground.
- Send `cmd/debug` with a valid `request_id` and inspect all raw values.
- Investigate any `-999999` pressure reading before retrying calibration.
- Confirm the hall sensor is connected to ADC channel 0 and changes with chest
  movement.

### Device still runs Unity test firmware

Return to the production project and flash it:

```powershell
cd code\resq-firmware
idf.py set-target esp32c3
idf.py -p COM4 build flash monitor
```

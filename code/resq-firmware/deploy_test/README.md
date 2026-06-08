# ResQ Firmware Deployment Qualification

This suite qualifies the **production** ESP32-C3 firmware on assembled ResQ
hardware. It builds and clean-flashes the device, provisions it over its SoftAP,
runs a mock registration backend and MQTT broker, exercises the external
protocol, guides physical checks, forces network outages, and writes auditable
evidence.

It complements the Unity application in `../test/`. Unity tests deterministic
state and component behavior. This suite covers the portions that require real
GPIO, ADC, HX710 devices, Wi-Fi, HTTP, MQTT, timing, power, and human
observation.

## Qualification rules

- The default run erases all flash and NVS. This is intentionally destructive.
- A required check is `PASS`, `FAIL`, or `SKIP`. A required `SKIP` makes the
  whole run `INCOMPLETE`; it never silently passes.
- Destructive button checks run last.
- Router and host WLAN restoration are attempted even after failure or Ctrl+C.
- Reports contain only observations from the current run. No passing report is
  stored in the repository.
- Wi-Fi passwords are read from the environment and redacted from transcripts.

## Hardware and wiring

Use an ESP32-C3 ResQ board with the production pin assignment:

| Function | Pin/channel |
|---|---|
| HX710 shared SCK | GPIO19 |
| Pressure sensor 0 DOUT | GPIO1 |
| Pressure sensor 1 DOUT | GPIO3 |
| Pressure sensor 2 DOUT | GPIO10 |
| Hall sensor | ADC channel 0 |
| State LED | GPIO7 |
| Activity LED | GPIO6 |
| Buzzer | GPIO18 |
| BUTTON_1 / turn off | GPIO4 |
| BUTTON_2 / factory reset | GPIO5 |

Prepare the real pressure bladders, hall sensor/chest mechanism, a known
reference pressure, USB data cable, and a way to power-cycle the board. Do not
qualify with floating sensor inputs.

## Host prerequisites

- Windows 10/11
- Python 3.11 or newer
- ESP-IDF v6.0 exported in the current shell
- Git, Ninja/CMake and the ESP32-C3 toolchain supplied by ESP-IDF
- Mosquitto on `PATH`, or its path in the configuration
- A Windows WLAN profile for the normal test LAN
- A router control script or executable for Wi-Fi outage injection

Install the Python dependencies:

```powershell
cd code\resq-firmware\deploy_test
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Run the host-side tests before using hardware:

```powershell
pytest -q
```

## Configuration

Copy `config.example.toml` to the ignored local file `config.toml`, then edit
the serial port, LAN profile, test-host IP, Mosquitto path, timing, calibration
references, and router hooks.

Set the WLAN password without writing it to TOML:

```powershell
$env:RESQ_TEST_WIFI_PASSWORD = "test-network-password"
```

The `host_ip` must be reachable by the ESP32 on the test LAN. The suite binds
the registration backend to all interfaces and advertises:

```text
http://<host_ip>:18080/api/devices/register
mqtt://<host_ip>:1883
```

### Windows WLAN automation

The configured `lan_profile` must already exist:

```powershell
netsh wlan show profiles
```

After a clean boot the runner scans for an SSID beginning `ResQ-`. If its exact
SSID has no Windows profile, the runner creates a current-user WPA2 profile in
a temporary directory using the firmware SoftAP password. It then:

1. Connects Windows to the ResQ SoftAP.
2. Polls `http://192.168.4.1/status`.
3. POSTs Wi-Fi and backend data to `/provision`.
4. POSTs the returned `ack_id` to `/provision/ack`.
5. Reconnects Windows to the normal LAN.
6. Waits for firmware registration and MQTT traffic.

If Windows WLAN is managed by organizational policy, run the shell with the
permissions needed by `netsh` or pre-create the ResQ SoftAP profile.

### Router command hooks

Hooks are argument arrays, never shell strings:

```toml
[router]
disable_command = ["powershell", "-File", "router-hook.ps1", "disable"]
enable_command = ["powershell", "-File", "router-hook.ps1", "enable"]
healthcheck_command = ["powershell", "-File", "router-hook.ps1", "status"]
timeout_seconds = 30
```

Each command receives these environment variables:

- `RESQ_WIFI_SSID`: test network SSID
- `RESQ_ROUTER_HOST`: configured test-host IP

The disable hook must make the ESP32 lose Wi-Fi without disconnecting the test
host from its ability to invoke the enable hook. The enable hook must be
idempotent. The health-check hook must exit zero only when the WLAN is restored.
Keep router credentials in environment variables or an ignored local secret
file used by the hook.

## Running the qualification

Open an ESP-IDF v6.0 PowerShell and run:

```powershell
cd code\resq-firmware\deploy_test
python -m resq_deploy_test run --config config.toml
```

The runner performs these phases in order:

1. **Preflight:** toolchain version, Windows tools, WLAN profile, secrets and
   router-hook configuration.
2. **Deployment:** `idf.py fullclean`, target selection, production build,
   complete flash erase, flash and serial capture.
3. **Provisioning:** SoftAP discovery, two-phase HTTP provisioning, LAN
   reconnection, registration and MQTT discovery.
4. **Protocol:** status and heartbeat schemas, registered device identity,
   request/reply IDs, debug sensor payload, unknown-command NACK and malformed
   JSON handling.
5. **Hardware:** guided LED, sensor movement and button debounce checks.
6. **Calibration:** real rest/reference/full-compression workflow and
   `READY_FOR_SESSION` confirmation.
7. **Session:** start, guided compressions, telemetry, buzzer/metronome,
   mismatched stop rejection and valid stop.
8. **Recovery:** short MQTT and Wi-Fi reconnects, then outages beyond the
   30-second boundary with exactly one terminal interruption per active session.
9. **Destructive:** BUTTON_1 long-press turn off, power-cycle persistence and
   BUTTON_2 long-press factory reset.

At each physical prompt enter:

- `y` only when the observation is correct.
- `n` when it is wrong.
- `s` when it cannot be performed. Required skips produce `INCOMPLETE`.

## Evidence

Every run creates `deploy_test/evidence/<UTC timestamp>/` containing:

| File | Purpose |
|---|---|
| `serial.log` | Timestamped ESP-IDF serial output |
| `mqtt.jsonl` | Timestamped topic and decoded payload stream |
| `commands.log` | Redacted build, flash, WLAN and hook transcript |
| `resq-deploy-*.json` | Machine-readable metadata and checks |
| `resq-deploy-*.xml` | JUnit report |
| `resq-deploy-*.md` | Human-readable qualification summary |

The JSON metadata includes the Git revision and dirty flag, ESP-IDF version,
target, serial port, host details, and SHA-256 hashes of built firmware images.
The process exits zero only for `PASS`; `FAIL`, `INCOMPLETE`, startup errors,
aborts and cleanup failures are nonzero.

## Expected state evidence

A clean successful run should externally observe:

```text
BOOT -> CONFIG_CHECK -> PROVISIONING -> WIFI_CONNECTING
-> BACKEND_REGISTERING -> MQTT_CONNECTING -> PAIRED_IDLE
-> CALIBRATING -> READY_FOR_SESSION
-> SESSION_ACTIVE -> READY_FOR_SESSION
```

Long active-session connectivity outages should produce one terminal
interruption event and `SESSION_INTERRUPTED`. Final BUTTON_1 and BUTTON_2 checks
exercise `TURN_OFF` and `RESETTING`. Internal failure branches and unsupported
state injection remain Unity responsibilities because production firmware has
no safe external command for forcing them.

Supported MQTT commands are:

```text
cmd/debug
cmd/calibration/start
cmd/calibration/cancel
cmd/session/start
cmd/session/stop
cmd/system/retry
cmd/system/reset
cmd/system/flush-config
```

There is deliberately no MQTT turn-off command. Turn-off is owned by the
BUTTON_1 long press.

The three `cmd/system/*` commands are ERROR-state recovery controls. The
deployment suite validates their topic contract and the Unity suite validates
their ERROR-state transitions. A hardware operator may exercise them after a
genuine sensor/runtime ERROR, but this runner does not falsify production state
or add a test-only remote error injector merely to make those commands
reachable.

## Troubleshooting

- **`ESP-IDF v6.0 required`:** run from the v6.0 exported shell and confirm
  `idf.py --version`.
- **Serial port busy:** close ESP-IDF monitor and other terminal applications.
- **No `ResQ-` SSID:** confirm flash erase succeeded, power-cycle, and inspect
  `serial.log` for `PROVISIONING`.
- **SoftAP profile failure:** pre-create the WLAN profile or run with sufficient
  Windows WLAN permissions.
- **Provision endpoint unavailable:** disable VPN routing that captures
  `192.168.4.0/24` and verify Windows is connected to the ResQ AP.
- **No registration:** verify Windows returned to the LAN, firewall permits the
  backend/MQTT ports, and `host_ip` is reachable from that LAN.
- **No sensor snapshot:** check shared HX710 SCK wiring and all three DOUT pins;
  `-999999` is the HX710 timeout sentinel.
- **Recovery cleanup failed:** manually run the configured enable hook, restore
  the LAN profile, and treat the run as failed.
- **Calibration fails:** use the published `reason_id` and `action_id` plus
  serial logs. Do not edit the report to convert a physical failure into PASS.

## Unity boundary

The Unity image under `../test/` covers deterministic state dispatch,
configuration boundaries, calibration/error code mappings, topic construction,
session lifecycle logic and CPR metric calculations. Run that suite separately
before production qualification. Never flash the Unity image as the device
under deployment test.

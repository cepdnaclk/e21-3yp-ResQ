**Overview**

**Purpose**: Describe how to run the ResQ firmware test stack locally with developer-specific settings loaded from a `.env` file.

**Local env file**: The launcher script `scripts/start-resq-firmware-test-stack.ps1` will load environment variables from a developer-local `.env` file. By default the script looks for:

* `scripts/resq-firmware-test-stack.env`

You can override the path with the `-EnvFile` parameter.

**Example files**:
* `scripts/resq-firmware-test-stack.env.example` — example template next to the script.
* `test_files/resq-firmware-test-stack.env.example` — alternate example in `test_files/`.

Copy one of those to the real file (`scripts/resq-firmware-test-stack.env`) and fill in your values. Do NOT commit the real file.

**Ignored paths**: The repository `.gitignore` includes entries to prevent committing the real env and provisioning artifacts:

* `scripts/resq-firmware-test-stack.env`
* `test_files/scripts/resq-firmware-test-stack.env`
* `test_files/evidence/provision_payload.json`
* `test_files/evidence/provision_qr.png`
* `test_files/evidence/provision_info.md`

**Script parameters**: CLI args override values from the `.env` file. Use the script like:

```powershell
.
  \scripts\start-resq-firmware-test-stack.ps1 \
    -EnvFile scripts/resq-firmware-test-stack.env \
    -RepoRoot D:\path\to\resq-firmware \
    -DeviceId RESQ-DEV-001 \
    -ComPort COM3 \
    -WifiSsid MySSID \
    -WifiPassword MyPassword \
    -BrokerHost localhost \
    -BackendHost http://localhost:8080
```

**Available parameters** (all optional):

* `-EnvFile` : Path to an env file (default `scripts/resq-firmware-test-stack.env`).
* `-RepoRoot` : Path to repository root; falls back to parent of `scripts/`.
* `-DeviceId` : Device identifier to use for tests.
* `-ComPort` : Serial port for the device (COMx or /dev/tty*).
* `-MqttPort` : MQTT port (default 1883).
* `-MockRegisterPort` : Port for mock register service (default 5000).
* `-WifiSsid` / `-WifiPassword` : Wi‑Fi credentials used during provisioning.
* `-BrokerHost` : MQTT broker host.
* `-BackendHost` : Backend/API host.
* `-AuthToken` : Optional auth token used by tests.
* `-UseWindowsTerminal` : Use Windows Terminal for launching helper panes.
* `-SkipMonitor` : Skip opening the serial monitor.
* `-SkipQr` : Skip generating/displaying QR provisioning artifacts.
* `-RunMqttTests` : Run MQTT integration tests.
* `-UseDockerBroker` : Use a local Dockerized broker instead of a system broker. (Note: Docker orchestration is disabled; the launcher will fall back to local or external broker behavior.)

**Stopping background processes / auto-stop**:

The launcher now automatically stops helper processes it started (mock register, local `mosquitto`, and the serial monitor) after the test runner completes. If you prefer to stop them manually or inspect logs before shutdown, run the launcher without `-RunMqttTests` and start helpers yourself.

If you need to stop processes manually, use the following PowerShell snippets as needed:

- Find and stop `mock_register.py`:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mock_register.py' } | Select-Object ProcessId, CommandLine
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'mock_register.py' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

- Stop local mosquitto:

```powershell
Stop-Process -Name mosquitto -Force
# or by PID:
Stop-Process -Id <PID> -Force
```

Close the serial monitor terminal window to stop the monitor if it was opened separately.

**Security notes**:

* Do NOT hardcode real Wi‑Fi passwords, tokens, or other secrets in the repository.
* Keep developer-local `.env` files private and out of source control.

**Next steps**:

* The script currently focuses on loading configuration and exporting it to the environment for downstream processes. You can extend the script to orchestrate launching Docker, mock services, and test runners that read these environment variables.

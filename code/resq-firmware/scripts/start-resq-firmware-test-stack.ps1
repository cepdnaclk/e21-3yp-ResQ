param(
    [string]$EnvFile = "",
    [string]$RepoRoot = "",
    [string]$DeviceId = "",
    [string]$ComPort = "",
    [int]$MqttPort = 0,
    [int]$MockRegisterPort = 0,
    [string]$WifiSsid = "",
    [string]$WifiPassword = "",
    [string]$BrokerHost = "",
    [string]$BackendHost = "",
    [string]$AuthToken = "",
    [switch]$UseWindowsTerminal,
    [switch]$SkipMonitor,
    [switch]$SkipQr,
    [switch]$RunMqttTests,
    [switch]$UseDockerBroker
)

# This script loads developer-local settings from a .env file (KEY=VALUE)
# CLI parameters override values from the .env file.

function Load-EnvFile {
    param([string]$Path)
    $map = @{}
    if (-not (Test-Path $Path)) { return $map }
    foreach ($line in Get-Content -Path $Path -ErrorAction SilentlyContinue) {
        $l = $line.Trim()
        if ($l -eq "" -or $l.StartsWith('#')) { continue }
        $l = $l -replace '^\s*export\s+',''
        if ($l -match '^\s*([^=]+)=(.*)$') {
            $k = $matches[1].Trim()
            $v = $matches[2].Trim()
            if (($v.StartsWith('"') -and $v.EndsWith('"')) -or ($v.StartsWith("'") -and $v.EndsWith("'"))) {
                if ($v.Length -ge 2) { $v = $v.Substring(1,$v.Length-2) }
            }
            $map[$k] = $v
        }
    }
    return $map
}

function ToBool($v) {
    if ($v -is [bool]) { return $v }
    if ($null -eq $v) { return $false }
    switch ($v.ToString().ToLower()) {
        'true' { return $true }
        '1' { return $true }
        'yes' { return $true }
        'y' { return $true }
        default { return $false }
    }
}

function Get-Value($cliVal, $key, $envMap) {
    if ($cliVal -ne "" -and $cliVal -ne $null) { return $cliVal }
    if ($envMap.ContainsKey($key)) { return $envMap[$key] }
    return $null
}

function Mask($s) {
    if (-not $s) { return '<not set>' }
    try {
        $len = $s.Length
        if ($len -le 4) { return '****' }
        return $s.Substring(0,2) + '****' + $s.Substring($len-2)
    } catch { return '****' }
}

# Determine script directory (works when invoked from anywhere)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Default env path (next to this script)
$defaultEnv = Join-Path $scriptDir 'resq-firmware-test-stack.env'

if ($EnvFile -and $EnvFile.Trim() -ne "") {
    $envPath = $EnvFile
    if (-not (Split-Path $envPath -IsAbsolute)) { $envPath = Join-Path $scriptDir $envPath }
} else {
    $envPath = $defaultEnv
}

$envMap = Load-EnvFile -Path $envPath

# Repo root: CLI > env > default (parent of scripts/)
if ($RepoRoot -eq "" -or $RepoRoot -eq $null) { $RepoRoot = Get-Value $RepoRoot 'REPO_ROOT' $envMap }
if (-not $RepoRoot) { try { $RepoRoot = (Resolve-Path (Join-Path $scriptDir '..')).ToString() } catch { $RepoRoot = $scriptDir } }

$DeviceId = Get-Value $DeviceId 'DEVICE_ID' $envMap
$ComPort = Get-Value $ComPort 'COM_PORT' $envMap
$WifiSsid = Get-Value $WifiSsid 'WIFI_SSID' $envMap
$WifiPassword = Get-Value $WifiPassword 'WIFI_PASSWORD' $envMap
$BrokerHost = Get-Value $BrokerHost 'BROKER_HOST' $envMap
$BackendHost = Get-Value $BackendHost 'BACKEND_HOST' $envMap
$AuthToken = Get-Value $AuthToken 'AUTH_TOKEN' $envMap

# Ports (CLI numeric > env > sane defaults)
if ($MqttPort -eq 0 -or $MqttPort -eq $null) {
    $mp = Get-Value "" 'MQTT_PORT' $envMap
    if ($mp) { try { $MqttPort = [int]$mp } catch { $MqttPort = 1883 } } else { $MqttPort = 1883 }
}
if ($MockRegisterPort -eq 0 -or $MockRegisterPort -eq $null) {
    $mrp = Get-Value "" 'MOCK_REGISTER_PORT' $envMap
    if ($mrp) { try { $MockRegisterPort = [int]$mrp } catch { $MockRegisterPort = 5000 } } else { $MockRegisterPort = 5000 }
}

# Switches: prefer CLI switch presence, otherwise fall back to env values
if (-not $UseWindowsTerminal) {
    $uv = $null
    if ($envMap.ContainsKey('USE_WINDOWS_TERMINAL')) { $uv = $envMap['USE_WINDOWS_TERMINAL'] }
    $UseWindowsTerminal = ToBool($uv)
}
if (-not $SkipMonitor) {
    $sv = $null
    if ($envMap.ContainsKey('SKIP_MONITOR')) { $sv = $envMap['SKIP_MONITOR'] }
    $SkipMonitor = ToBool($sv)
}
if (-not $SkipQr) {
    $qv = $null
    if ($envMap.ContainsKey('SKIP_QR')) { $qv = $envMap['SKIP_QR'] }
    $SkipQr = ToBool($qv)
}
if (-not $RunMqttTests) {
    $rv = $null
    if ($envMap.ContainsKey('RUN_MQTT_TESTS')) { $rv = $envMap['RUN_MQTT_TESTS'] }
    $RunMqttTests = ToBool($rv)
}
if (-not $UseDockerBroker) {
    $dv = $null
    if ($envMap.ContainsKey('USE_DOCKER_BROKER')) { $dv = $envMap['USE_DOCKER_BROKER'] }
    $UseDockerBroker = ToBool($dv)
}

# Export selected values to the process environment so child processes can read them
if ($WifiSsid) { $env:WIFI_SSID = $WifiSsid }
if ($WifiPassword) { $env:WIFI_PASSWORD = $WifiPassword }
if ($BrokerHost) { $env:BROKER_HOST = $BrokerHost }
if ($BackendHost) { $env:BACKEND_HOST = $BackendHost }
if ($AuthToken) { $env:AUTH_TOKEN = $AuthToken }
if ($DeviceId) { $env:DEVICE_ID = $DeviceId }
if ($ComPort) { $env:COM_PORT = $ComPort }
$env:MQTT_PORT = $MqttPort.ToString()
$env:MOCK_REGISTER_PORT = $MockRegisterPort.ToString()

Write-Host "Using env file: $envPath"
Write-Host "Repository root: $RepoRoot"
Write-Host "Device ID: $DeviceId"
Write-Host "COM port: $ComPort"
Write-Host "MQTT broker: $BrokerHost`:$MqttPort"
Write-Host "Backend host: $BackendHost"
Write-Host "Wi‑Fi SSID: $(if ($WifiSsid) { $WifiSsid } else { '<not set>' })"
Write-Host "Wi‑Fi password: $(Mask $WifiPassword)"
Write-Host "Auth token: $(Mask $AuthToken)"
Write-Host "Use Windows Terminal: $UseWindowsTerminal"
Write-Host "Skip monitor: $SkipMonitor, Skip QR: $SkipQr, Run MQTT tests: $RunMqttTests, Use Docker broker: $UseDockerBroker"

# TODO: launch the rest of the test stack here. This script intentionally focuses on
# loading developer-local configuration and exposing it to downstream steps.

Write-Host "Configuration loaded. Child processes will inherit key environment variables."

# --- Orchestration helpers --------------------------------------------------
function Start-MockRegister {
    param([string]$RepoRoot)
    $mock = Join-Path $RepoRoot 'test_files\scripts\mock_register.py'
    if (-not (Test-Path $mock)) { Write-Host "Mock register not found: $mock"; return $null }
    try {
        Write-Host "Starting mock register: $mock"
        $proc = Start-Process -FilePath python -ArgumentList @($mock) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden
        Write-Host "Mock register started (PID: $($proc.Id))"
        return $proc
    } catch {
        Write-Host "Failed to start mock register: $_"
        return $null
    }
}

# NOTE: Docker-based orchestration intentionally omitted per developer preference.
# If you need Docker support later, reintroduce a Start-MosquittoDocker helper.

function Start-MosquittoLocal {
    param([int]$Port, [string]$RepoRoot)
    $conf = Join-Path $RepoRoot 'test_files\scripts\mosquitto-resq.conf'
    $mosq = Get-Command mosquitto -ErrorAction SilentlyContinue
    if (-not $mosq) { Write-Host "mosquitto binary not found in PATH."; return $null }
    try {
        $args = @()
        if (Test-Path $conf) { $args = @('-c', $conf) }
        Write-Host "Starting local mosquitto: mosquitto $($args -join ' ')"
        $proc = Start-Process -FilePath mosquitto -ArgumentList $args -WorkingDirectory $RepoRoot -PassThru
        Write-Host "mosquitto started (PID: $($proc.Id))"
        return $proc
    } catch {
        Write-Host "Failed to start local mosquitto: $_"
        return $null
    }
}

function Start-SerialMonitor {
    param([string]$ComPort, [switch]$UseWindowsTerminal)
    if (-not $ComPort) { Write-Host "No COM port provided; skipping serial monitor."; return }
    $cmd = "idf.py -p $ComPort monitor"
    if ($UseWindowsTerminal) {
        $wt = Get-Command wt -ErrorAction SilentlyContinue
        if ($wt) {
            Write-Host "Opening monitor in Windows Terminal: $cmd"
            $proc = Start-Process -FilePath wt -ArgumentList @('new-tab','powershell','-NoExit','-Command', $cmd) -PassThru
            return $proc
        }
    }
    Write-Host "Opening monitor in new PowerShell window: $cmd"
    $proc = Start-Process -FilePath powershell -ArgumentList @('-NoExit','-Command', $cmd) -PassThru
    return $proc
}

function Start-TestRunner {
    param([string]$RepoRoot, [string]$Broker, [int]$Port, [string]$DeviceId)
    $runner = Join-Path $RepoRoot 'test_files\scripts\resq_mqtt_test_runner.py'
    if (-not (Test-Path $runner)) { Write-Host "Test runner not found: $runner"; return 1 }
    $args = @($runner, '--broker', $Broker, '--port', $Port.ToString(), '--device', $DeviceId)
    Write-Host "Starting MQTT test runner: python $($args -join ' ')"
    try {
        & python @args
        return $LASTEXITCODE
    } catch {
        Write-Host "Test runner failed to start: $_"
        return 2
    }
}

# --- Orchestrate based on flags -------------------------------------------
if ($RunMqttTests) {
    Write-Host "RunMqttTests flag is set — preparing to start mock services and test runner."

    # Start mock register if present
    $mockProc = Start-MockRegister -RepoRoot $RepoRoot

    # Start broker: prefer local mosquitto when broker is localhost and mosquitto binary exists.
    # Docker orchestration is intentionally disabled; if UseDockerBroker is set we'll warn and continue.
    $mosquittoProc = $null
    if ($UseDockerBroker) {
        Write-Host "UseDockerBroker requested, but Docker orchestration is disabled in this script. Falling back to local/external broker behavior."
    }
    if (($BrokerHost -eq 'localhost' -or $BrokerHost -eq '127.0.0.1') -and (Get-Command mosquitto -ErrorAction SilentlyContinue)) {
        $mosquittoProc = Start-MosquittoLocal -Port $MqttPort -RepoRoot $RepoRoot
        Start-Sleep -Seconds 1
    } else {
        Write-Host "Assuming external broker at $BrokerHost:$MqttPort (not starting a local broker)."
    }

    # Start serial monitor unless skipped; capture process so we can stop it later
    $monitorProc = $null
    if (-not $SkipMonitor -and $ComPort) {
        $monitorProc = Start-SerialMonitor -ComPort $ComPort -UseWindowsTerminal:$UseWindowsTerminal
    }

    # Run the test runner in the foreground so user sees output; ensure background services are stopped afterwards
    $rc = 1
    try {
        $rc = Start-TestRunner -RepoRoot $RepoRoot -Broker $BrokerHost -Port $MqttPort -DeviceId $DeviceId
        Write-Host "Test runner finished with exit code: $rc"
    } finally {
        Write-Host "Shutting down helper processes started by launcher..."
        if ($mockProc) {
            try {
                Write-Host "Stopping mock register (PID: $($mockProc.Id))"
                Stop-Process -Id $mockProc.Id -Force -ErrorAction Stop
            } catch {
                Write-Host "Failed to stop mock register: $_"
            }
        }
        if ($mosquittoProc) {
            try {
                Write-Host "Stopping mosquitto (PID: $($mosquittoProc.Id))"
                Stop-Process -Id $mosquittoProc.Id -Force -ErrorAction Stop
            } catch {
                Write-Host "Failed to stop mosquitto: $_"
            }
        }
        if ($monitorProc) {
            try {
                Write-Host "Stopping serial monitor (PID: $($monitorProc.Id))"
                Stop-Process -Id $monitorProc.Id -Force -ErrorAction Stop
            } catch {
                Write-Host "Failed to stop serial monitor: $_"
            }
        }
        Write-Host "Helper processes shutdown complete."
    }
}

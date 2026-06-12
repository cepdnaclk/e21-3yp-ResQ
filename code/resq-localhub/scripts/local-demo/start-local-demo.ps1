param(
    [string]$DeviceId = "M01",
    [ValidateSet("pass", "fail")]
    [string]$CalibrationMode = "pass",
    [switch]$RunSimulator,
    [switch]$SkipWatcher,
    [switch]$SkipDesktop,
    [switch]$SkipBroker,
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$currentRoot = (Resolve-Path (Get-Location)).Path

if (-not [System.String]::Equals($currentRoot.TrimEnd('\'), $repoRoot.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "Run this script from the repository root: $repoRoot"
    exit 1
}

function Start-DemoWindow {
    param(
        [Parameter(Mandatory)]
        [string]$Title,
        [Parameter(Mandatory)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory)]
        [string]$Command
    )

    $arguments = @(
        "-NoExit",
        "-ExecutionPolicy", "Bypass"
    )

    $arguments += @("-Command", $Command)

    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $WorkingDirectory -WindowStyle Normal -PassThru
    Write-Host "Launched $Title (PID $($process.Id))"
}

function Quote-Path([string]$Path) {
    return "'" + ($Path -replace "'", "''") + "'"
}

$launched = New-Object System.Collections.Generic.List[string]

if (-not $SkipBroker) {
    Start-DemoWindow -Title "Mosquitto Broker" -WorkingDirectory $repoRoot -Command "mosquitto -c .\infra\mosquitto\mosquitto.dev.conf"
    $launched.Add("broker")
}

if (-not $SkipBackend) {
    $backendRoot = Join-Path $repoRoot "services\hub-api"
    Start-DemoWindow -Title "Hub API Backend" -WorkingDirectory $backendRoot -Command ".\mvnw.cmd spring-boot:run"
    $launched.Add("backend")
}

if (-not $SkipDesktop) {
    $desktopRoot = Join-Path $repoRoot "apps\localhub-desktop"
    Start-DemoWindow -Title "LocalHub Desktop" -WorkingDirectory $desktopRoot -Command "pnpm.cmd dev"
    $launched.Add("desktop")
}

if ($RunSimulator) {
    $simulatorScript = Join-Path $repoRoot "scripts\local-demo\start-firmware-simulator.ps1"
    $simulatorCommand = "& {0} -DeviceId {1} -CalibrationMode {2}" -f (Quote-Path $simulatorScript), (Quote-Path $DeviceId), (Quote-Path $CalibrationMode)
    Start-DemoWindow -Title "Firmware Simulator" -WorkingDirectory $repoRoot -Command $simulatorCommand
    $launched.Add("simulator")
}

if (-not $SkipWatcher) {
    $watcherScript = Join-Path $repoRoot "scripts\local-demo\demo-mqtt-watch.ps1"
    $watcherCommand = "& {0}" -f (Quote-Path $watcherScript)
    Start-DemoWindow -Title "MQTT Watcher" -WorkingDirectory $repoRoot -Command $watcherCommand
    $launched.Add("watcher")
}

if ($launched.Count -gt 0) {
    $healthScript = Join-Path $repoRoot "scripts\check-localhub-service-info.ps1"
    $healthCommand = "& {0}" -f (Quote-Path $healthScript)
    Start-DemoWindow -Title "Service Info Check" -WorkingDirectory $repoRoot -Command $healthCommand
    $launched.Add("health-check")
}

Write-Host ""
if ($launched.Count -eq 0) {
    Write-Host "No demo services were launched because all skip switches were provided."
} else {
    Write-Host "Launched: $($launched -join ', ')"
}

Write-Host "Next manual steps:"
Write-Host "1. Wait for the backend to start and confirm the health window passes."
Write-Host "2. Check service-info output for backend_base_url, mqtt_host, mqtt_port, dashboard_url, and local_ip."
Write-Host "3. Open the dashboard at http://localhost:1420."
Write-Host "4. Run calibration for the target device."
Write-Host "5. Start a session."
Write-Host "6. Stop the session."
Write-Host "7. Review and export the completed session."

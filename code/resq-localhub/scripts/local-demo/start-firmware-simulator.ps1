param(
    [string]$DeviceId = "resq-node-01",
    [string]$MqttUrl = "mqtt://localhost:1883",
    [ValidateSet("pass", "fail")]
    [string]$CalibrationMode = "pass",
    [switch]$SimulateError,
    [switch]$SimulateInterrupted
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$simulator = Join-Path $repoRoot "scripts\firmware-simulator\firmware-simulator.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "node was not found on PATH. Install Node.js before starting the simulator."
}

$args = @(
    $simulator,
    "--device-id", $DeviceId,
    "--mqtt-url", $MqttUrl,
    "--calibration-mode", $CalibrationMode
)

if ($SimulateError) {
    $args += "--simulate-error"
}

if ($SimulateInterrupted) {
    $args += "--simulate-interrupted"
}

Write-Host "Starting firmware simulator for $DeviceId on $MqttUrl ..."
Write-Host "Press Ctrl+C to stop."
& node @args

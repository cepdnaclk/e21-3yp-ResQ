param(
    [switch]$Help,
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$Username,
    [string]$Password
)

$ErrorActionPreference = "Stop"

if ($Help) {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\firmware-simulator\watch-real-firmware-mqtt.ps1 [-BrokerHost 127.0.0.1] [-BrokerPort 1883] [-Username user] [-Password secret]"
    Write-Host "Subscribes to resq/+/status, heartbeat, telemetry, debug, events, events/calibration, and events/error."
    return
}

if (-not (Get-Command mosquitto_sub -ErrorAction SilentlyContinue)) {
    throw "mosquitto_sub was not found on PATH. Install the Mosquitto clients or add them to PATH."
}

$args = @(
    "-h", $BrokerHost,
    "-p", $BrokerPort,
    "-V", "mqttv5",
    "-v"
)

if ($Username) {
    $args += @("-u", $Username)
}

if ($Password) {
    $args += @("-P", $Password)
}

foreach ($topic in @(
    "resq/+/status",
    "resq/+/heartbeat",
    "resq/+/telemetry",
    "resq/+/debug",
    "resq/+/events",
    "resq/+/events/calibration",
    "resq/+/events/error"
)) {
    $args += @("-t", $topic)
}

Write-Host "Subscribing to real firmware MQTT trace topics on ${BrokerHost}:${BrokerPort} ..."
Write-Host "Press Ctrl+C to stop."
& mosquitto_sub @args

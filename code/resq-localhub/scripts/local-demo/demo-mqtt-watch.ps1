param(
    [switch]$Help,
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$Username,
    [string]$Password
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$watchScript = Join-Path $repoRoot "scripts\firmware-simulator\watch-real-firmware-mqtt.ps1"

if ($Help) {
    Write-Host "Usage: powershell -ExecutionPolicy Bypass -File .\scripts\local-demo\demo-mqtt-watch.ps1 [-BrokerHost 127.0.0.1] [-BrokerPort 1883] [-Username user] [-Password secret]"
    Write-Host "This wraps the firmware MQTT trace helper and subscribes to canonical resq/+/... demo topics."
    return
}

$params = @{
    BrokerHost = $BrokerHost
    BrokerPort = $BrokerPort
}

if ($Username) {
    $params["Username"] = $Username
}

if ($Password) {
    $params["Password"] = $Password
}

& powershell -ExecutionPolicy Bypass -File $watchScript @params

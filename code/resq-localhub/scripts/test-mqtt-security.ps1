param(
    [string]$BrokerHost = "127.0.0.1",
    [int]$TcpPort = 1883,
    [string]$DashboardUser = "dashboard",
    [string]$DashboardPassword,
    [string]$BackendUser = "backend",
    [string]$BackendPassword,
    [string]$DeviceUser = "device_demo",
    [string]$DevicePassword,
    [string]$DeviceId = "M01"
)

$ErrorActionPreference = "Stop"

foreach ($tool in @("mosquitto_pub", "mosquitto_sub")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "$tool was not found on PATH. Install Mosquitto clients or add it to PATH."
    }
}

foreach ($required in @(
    @{ Name = "DashboardPassword"; Value = $DashboardPassword },
    @{ Name = "BackendPassword"; Value = $BackendPassword },
    @{ Name = "DevicePassword"; Value = $DevicePassword }
)) {
    if (-not $required.Value) {
        throw "Pass -$($required.Name). Do not hardcode real secrets in scripts."
    }
}

function Invoke-MqttPub {
    param(
        [string]$User,
        [string]$Password,
        [string]$Topic,
        [string]$Payload
    )

    $output = & mosquitto_pub -h $BrokerHost -p $TcpPort -V mqttv5 -q 1 -u $User -P $Password -t $Topic -m $Payload 2>&1
    return @{ ExitCode = $LASTEXITCODE; Output = ($output -join "`n") }
}

function Assert-Succeeds {
    param($Result, [string]$Message)
    if ($Result.ExitCode -ne 0) {
        throw "$Message failed unexpectedly. Output: $($Result.Output)"
    }
}

function Assert-Fails {
    param($Result, [string]$Message)
    if ($Result.ExitCode -eq 0) {
        throw "$Message succeeded unexpectedly."
    }
}

$telemetryTopic = "resq/manikins/$DeviceId/telemetry"
$commandTopic = "resq/manikins/$DeviceId/cmd/session/start"
$payload = '{"deviceId":"M01","sessionId":"S-SECURITY-SMOKE","depthMm":52,"rateCpm":110,"recoilOk":true}'
$commandPayload = '{"sessionId":"S-SECURITY-SMOKE","deviceId":"M01"}'

Write-Host "Checking dashboard user cannot publish telemetry ..."
Assert-Fails (Invoke-MqttPub $DashboardUser $DashboardPassword $telemetryTopic $payload) "Dashboard telemetry publish"

Write-Host "Checking dashboard user cannot publish command topics ..."
Assert-Fails (Invoke-MqttPub $DashboardUser $DashboardPassword $commandTopic $commandPayload) "Dashboard command publish"

Write-Host "Checking device role can publish telemetry ..."
Assert-Succeeds (Invoke-MqttPub $DeviceUser $DevicePassword $telemetryTopic $payload) "Device telemetry publish"

Write-Host "Checking backend user can publish command topics ..."
Assert-Succeeds (Invoke-MqttPub $BackendUser $BackendPassword $commandTopic $commandPayload) "Backend command publish"

Write-Host "MQTT ACL publish checks passed."
Write-Host "Use docs/mqtt-security.md for subscribe checks and broker startup commands."

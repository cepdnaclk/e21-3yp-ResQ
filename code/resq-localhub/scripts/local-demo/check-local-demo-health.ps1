param(
    [string]$BackendBaseUrl = "http://localhost:18080",
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$DashboardUrl = "http://localhost:1420"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonGet {
    param([string]$Uri)
    Invoke-RestMethod -Uri $Uri -Method Get
}

function Test-TcpPort {
    param(
        [string]$ComputerName,
        [int]$Port
    )

    try {
        return Test-NetConnection -ComputerName $ComputerName -Port $Port -InformationLevel Quiet
    } catch {
        return $false
    }
}

Write-Host "Checking backend health at $BackendBaseUrl/api/hub/health ..."
$health = Invoke-JsonGet "$BackendBaseUrl/api/hub/health"
if (-not $health.ok) {
    throw "Backend health check returned ok=false."
}
Write-Host "Backend health: OK"
Write-Host "Timestamp: $($health.timestamp)"

Write-Host "Checking service-info at $BackendBaseUrl/api/hub/service-info ..."
$serviceInfo = Invoke-JsonGet "$BackendBaseUrl/api/hub/service-info"
Write-Host "backend_base_url: $($serviceInfo.backend_base_url)"
Write-Host "mqtt_host: $($serviceInfo.mqtt_host)"
Write-Host "mqtt_port: $($serviceInfo.mqtt_port)"
Write-Host "dashboard_url: $($serviceInfo.dashboard_url)"
Write-Host "local_ip: $($serviceInfo.local_ip)"

$brokerReachable = Test-TcpPort -ComputerName $BrokerHost -Port $BrokerPort
Write-Host "Broker port ${BrokerHost}:${BrokerPort} reachable: $brokerReachable"
Write-Host "Dashboard URL: $DashboardUrl"

if (-not $brokerReachable) {
    throw "MQTT broker port ${BrokerHost}:${BrokerPort} is not reachable."
}

Write-Host "Checking sample firmware registration shape ..."
$sampleProvisioning = @{
    wifi_ssid = "training-wifi"
    wifi_password = "password"
    backend_base_url = $serviceInfo.backend_base_url
}
$sampleProvisioning | ConvertTo-Json -Depth 8 | Write-Host

Write-Host "Local demo health checks passed."

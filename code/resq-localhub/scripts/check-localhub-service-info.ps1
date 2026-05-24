param(
    [string]$BackendBaseUrl = "http://localhost:18080",
    [string]$Mac = "AA:BB:CC:DD:EE:FF",
    [string]$ChipId = "ESP32-LOCALHUB-0001",
    [string]$FirmwareVersion = "1.0.0",
    [string]$DeviceLabel = "LocalHub Test Device"
)

$ErrorActionPreference = "Stop"

function Invoke-JsonRequest {
    param(
        [ValidateSet("Get", "Post")]
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )

    $params = @{
        Uri         = "$BackendBaseUrl$Path"
        Method      = $Method
        ContentType = "application/json"
    }

    if ($null -ne $Body) {
        $params["Body"] = ($Body | ConvertTo-Json -Depth 8)
    }

    Invoke-RestMethod @params
}

Write-Host "Checking $BackendBaseUrl/api/hub/service-info ..."
$serviceInfo = Invoke-JsonRequest -Method Get -Path "/api/hub/service-info"
Write-Host "backend_base_url: $($serviceInfo.backend_base_url)"
Write-Host "mqtt_host: $($serviceInfo.mqtt_host)"
Write-Host "mqtt_port: $($serviceInfo.mqtt_port)"
Write-Host "dashboard_url: $($serviceInfo.dashboard_url)"
Write-Host "local_ip: $($serviceInfo.local_ip)"

Write-Host "Checking $BackendBaseUrl/api/devices/register ..."
$registrationRequest = @{
    mac = $Mac
    chip_id = $ChipId
    firmware_version = $FirmwareVersion
    device_label = $DeviceLabel
}
$registrationResponse = Invoke-JsonRequest -Method Post -Path "/api/devices/register" -Body $registrationRequest
Write-Host "Sample provisioning JSON:"
@{
    wifi_ssid = "training-wifi"
    wifi_password = "password"
    backend_base_url = $serviceInfo.backend_base_url
} | ConvertTo-Json -Depth 8 | Write-Host

Write-Host "Sample firmware registration response:"
@{
    ok = $registrationResponse.ok
    device_id = $registrationResponse.device_id
    mqtt_host = $registrationResponse.mqtt_host
    mqtt_port = $registrationResponse.mqtt_port
} | ConvertTo-Json -Depth 8 | Write-Host

if (-not $serviceInfo.ok) {
    throw "Service info response reported ok=false."
}

if (-not $registrationResponse.ok) {
    throw "Registration response reported ok=false."
}

Write-Host "Service-info and registration checks passed."

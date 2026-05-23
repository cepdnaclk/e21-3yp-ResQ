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
$serviceInfo | ConvertTo-Json -Depth 8 | Write-Host

Write-Host "Checking $BackendBaseUrl/api/devices/register ..."
$registrationRequest = @{
    mac = $Mac
    chip_id = $ChipId
    firmware_version = $FirmwareVersion
    device_label = $DeviceLabel
}
$registrationResponse = Invoke-JsonRequest -Method Post -Path "/api/devices/register" -Body $registrationRequest
$registrationResponse | ConvertTo-Json -Depth 8 | Write-Host

if (-not $serviceInfo.ok) {
    throw "Service info response reported ok=false."
}

if (-not $registrationResponse.ok) {
    throw "Registration response reported ok=false."
}

Write-Host "Service-info and registration checks passed."

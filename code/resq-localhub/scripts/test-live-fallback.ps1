param(
    [string]$BackendBaseUrl = "http://localhost:18080",
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$DeviceId = "M01",
    [string]$SessionId,
    [string]$Cookie,
    [switch]$StaticOnly,
    [switch]$SkipPublish,
    [switch]$IncludeInvalidSamples
)

$ErrorActionPreference = "Stop"

function Invoke-ResqGet {
    param([string]$Path)

    $headers = @{}
    if ($Cookie) {
        $headers["Cookie"] = $Cookie
    }

    Invoke-RestMethod -Uri "$BackendBaseUrl$Path" -Headers $headers -Method Get
}

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

Write-Host "Checking frontend MQTT client does not expose publish calls ..."
$frontendSources = Get-ChildItem -LiteralPath "$PSScriptRoot\..\apps\localhub-desktop\src" -Recurse -Include *.ts,*.tsx
$publishHits = $frontendSources | Select-String -Pattern "\.publish\(|publishSession|command topic|commands/" -CaseSensitive
if ($publishHits) {
    $publishHits | ForEach-Object { Write-Host "$($_.Path):$($_.LineNumber) $($_.Line.Trim())" }
    throw "Potential frontend MQTT publish or command-topic code was found."
}

if ($StaticOnly) {
    Write-Host "Static live fallback checks passed."
    return
}

if (-not $SessionId) {
    throw "Pass -SessionId for an ACTIVE backend session. Phase 6 validation rejects arbitrary session IDs."
}

Write-Host "Checking backend health at $BackendBaseUrl ..."
Invoke-ResqGet "/api/hub/health" | Out-Null

if (-not $SkipPublish) {
    Write-Host "Publishing heartbeat, status, and metric-first telemetry for $DeviceId / $SessionId ..."
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Sample heartbeat
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Sample status
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Sample metric-first
    Start-Sleep -Milliseconds 800
}

Write-Host "Checking REST fallback by device ..."
$deviceSnapshot = Invoke-ResqGet "/api/manikins/live/$DeviceId"
Assert-Condition ($deviceSnapshot.deviceId -eq $DeviceId) "Device snapshot returned wrong deviceId."
Assert-Condition ($deviceSnapshot.latestMetric.deviceId -eq $DeviceId) "Device latestMetric returned wrong deviceId."
Assert-Condition ($deviceSnapshot.latestMetric.sessionId -eq $SessionId) "Device latestMetric returned wrong sessionId."
Assert-Condition ($deviceSnapshot.latestMetric.depthMm -eq 52) "Device latestMetric did not include expected depthMm."

Write-Host "Checking REST fallback by session ..."
$sessionSnapshot = Invoke-ResqGet "/api/sessions/live/$SessionId"
Assert-Condition ($sessionSnapshot.deviceId -eq $DeviceId) "Session snapshot returned wrong deviceId."
Assert-Condition ($sessionSnapshot.latestMetric.sessionId -eq $SessionId) "Session latestMetric returned wrong sessionId."
Assert-Condition ($sessionSnapshot.latestMetric.rateCpm -eq 110) "Session latestMetric did not include expected rateCpm."

if ($IncludeInvalidSamples) {
    Write-Host "Publishing invalid samples; these should not replace the selected live metric ..."
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Seq 2 -Sample wrong-session
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Seq 3 -Sample wrong-device
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Seq 4 -Sample incomplete
    & "$PSScriptRoot\publish-sample-telemetry.ps1" -BrokerHost $BrokerHost -BrokerPort $BrokerPort -DeviceId $DeviceId -SessionId $SessionId -Seq 5 -Sample malformed
    Start-Sleep -Milliseconds 800

    $afterInvalid = Invoke-ResqGet "/api/sessions/live/$SessionId"
    Assert-Condition ($afterInvalid.latestMetric.sessionId -eq $SessionId) "Invalid telemetry changed the selected session."
    Assert-Condition ($afterInvalid.latestMetric.deviceId -eq $DeviceId) "Invalid telemetry changed the selected device."
}

Write-Host "Live fallback backend smoke checks passed."
Write-Host "Use docs/live-fallback-test-plan.md for Direct MQTT, SSE failure, polling, stale/offline, and recovery UI observations."

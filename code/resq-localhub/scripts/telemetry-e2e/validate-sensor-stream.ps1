param(
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$BackendBaseUrl = "http://localhost:8080",
    [string]$DeviceId = "M-E2E",
    [int]$IntervalMs = 200,
    [string]$MqttUsername = "",
    [string]$MqttPassword = "",
    [int]$PacketWindowSeconds = 5,
    [int]$StopQuietSeconds = 2
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
    Write-Host "FAIL: $Message" -ForegroundColor Red
    exit 1
}

function Pass($Message) {
    Write-Host "PASS: $Message" -ForegroundColor Green
}

function Assert-Command($Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Fail "$Name is required on PATH"
    }
}

function ConvertFrom-JsonLine($Line) {
    try {
        return $Line | ConvertFrom-Json -ErrorAction Stop
    } catch {
        return $null
    }
}

if ($IntervalMs -lt 100 -or $IntervalMs -gt 1000) {
    Fail "Interval must be between 100 and 1000 ms"
}

Assert-Command "mosquitto_sub"
Assert-Command "curl"

$topic = "resq/$DeviceId/#"
$subArgs = @("-h", $BrokerHost, "-p", "$BrokerPort", "-t", $topic, "-v")
if ($MqttUsername) {
    $subArgs += @("-u", $MqttUsername)
}
if ($MqttPassword) {
    $subArgs += @("-P", $MqttPassword)
}

$logPath = Join-Path $env:TEMP ("resq-sensor-stream-" + [Guid]::NewGuid() + ".log")
$subscriber = Start-Process -FilePath "mosquitto_sub" -ArgumentList $subArgs -NoNewWindow -RedirectStandardOutput $logPath -PassThru
try {
    Start-Sleep -Milliseconds 500

    $startBody = @{ interval_ms = $IntervalMs } | ConvertTo-Json -Compress
    $start = Invoke-RestMethod -Method Post -Uri "$BackendBaseUrl/api/devices/$DeviceId/telemetry/start" -ContentType "application/json" -Body $startBody
    $requestId = $start.request_id
    if (-not $requestId) {
        Fail "START response did not include request_id"
    }
    Pass "START published request_id=$requestId"

    $deadline = (Get-Date).AddSeconds($PacketWindowSeconds)
    $ackSeen = $false
    $packets = @()
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 250
        if (-not (Test-Path $logPath)) {
            continue
        }
        foreach ($line in Get-Content -LiteralPath $logPath) {
            $space = $line.IndexOf(" ")
            if ($space -lt 0) {
                continue
            }
            $payload = ConvertFrom-JsonLine $line.Substring($space + 1)
            if ($null -eq $payload) {
                continue
            }
            if ($payload.reply_id -eq $requestId -and $payload.status -eq "ACK") {
                $ackSeen = $true
            }
            if ($payload.telemetry_mode -eq "SENSOR_STREAM") {
                $packets += $payload
            }
        }
        if ($ackSeen -and $packets.Count -ge 3) {
            break
        }
    }

    if (-not $ackSeen) {
        Fail "START ACK with reply_id=$requestId was not observed"
    }
    if ($packets.Count -lt 3) {
        Fail "Expected at least 3 SENSOR_STREAM packets, observed $($packets.Count)"
    }

    $latestPacket = $packets[-1]
    foreach ($field in @(
        "device_id", "telemetry_mode", "state",
        "pressure_0_kpa", "pressure_0_kpa_valid",
        "pressure_1_kpa", "pressure_1_kpa_valid",
        "pressure_2_kpa", "pressure_2_kpa_valid",
        "pressure_kpa_valid", "hall_mm", "hall_progress",
        "hall_mm_valid", "pressure_saturation_mask", "interval_ms", "ts_ms"
    )) {
        if (-not ($latestPacket.PSObject.Properties.Name -contains $field)) {
            Fail "Latest SENSOR_STREAM packet missing $field"
        }
    }
    Pass "Observed $($packets.Count) SENSOR_STREAM packets"

    $latest = Invoke-RestMethod -Method Get -Uri "$BackendBaseUrl/api/devices/$DeviceId/telemetry/latest"
    if (-not $latest.latest_snapshot) {
        Fail "Latest snapshot endpoint did not return latest_snapshot"
    }
    Pass "Latest snapshot endpoint returned a snapshot"

    $beforeStopCount = $packets.Count
    $stop = Invoke-RestMethod -Method Post -Uri "$BackendBaseUrl/api/devices/$DeviceId/telemetry/stop"
    $stopRequestId = $stop.request_id
    if (-not $stopRequestId) {
        Fail "STOP response did not include request_id"
    }

    Start-Sleep -Seconds $StopQuietSeconds
    $afterStopPackets = @()
    foreach ($line in Get-Content -LiteralPath $logPath) {
        $space = $line.IndexOf(" ")
        if ($space -lt 0) {
            continue
        }
        $payload = ConvertFrom-JsonLine $line.Substring($space + 1)
        if ($payload -and $payload.telemetry_mode -eq "SENSOR_STREAM") {
            $afterStopPackets += $payload
        }
    }
    $newAfterStop = $afterStopPackets.Count - $beforeStopCount
    if ($newAfterStop -gt 1) {
        Fail "SENSOR_STREAM publication continued after STOP; observed $newAfterStop extra packets"
    }

    Pass "STOP accepted and stream quieted"
    Write-Host ""
    Write-Host "PASS SUMMARY"
    Write-Host "Device: $DeviceId"
    Write-Host "Interval: $IntervalMs ms"
    Write-Host "START request_id: $requestId"
    Write-Host "STOP request_id: $stopRequestId"
    Write-Host "Packets observed before STOP: $beforeStopCount"
    Write-Host "Hardware sensor accuracy: NOT ASSERTED"
} finally {
    if ($subscriber -and -not $subscriber.HasExited) {
        Stop-Process -Id $subscriber.Id -Force
    }
    if (Test-Path $logPath) {
        Write-Host "MQTT capture log: $logPath"
    }
}

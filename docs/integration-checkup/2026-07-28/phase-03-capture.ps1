param(
    [string] $RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path,
    [switch] $SkipIdle,
    [switch] $OnlySensor
)

$ErrorActionPreference = "Stop"
$EvidenceRoot = $PSScriptRoot
$LocalHubRoot = Join-Path $RepositoryRoot "code\resq-localhub"
$Simulator = Join-Path $LocalHubRoot "scripts\firmware-simulator\firmware-simulator.js"
$DeviceId = "M01"
$SessionId = "S-PHASE03-001"
$BrokerHost = "127.0.0.1"
$BrokerPort = 1883
$BackendBaseUrl = "http://127.0.0.1:18080"

function Publish-MqttJson {
    param(
        [Parameter(Mandatory)] [string] $Topic,
        [Parameter(Mandatory)] [hashtable] $Payload
    )

    $json = $Payload | ConvertTo-Json -Compress
    $payloadPath = Join-Path $EvidenceRoot "phase-03-command-payload.json"
    [System.IO.File]::WriteAllText($payloadPath, $json, [System.Text.UTF8Encoding]::new($false))
    & mosquitto_pub -h $BrokerHost -p $BrokerPort -t $Topic -f $payloadPath -q 1
    if ($LASTEXITCODE -ne 0) {
        throw "mosquitto_pub failed for $Topic with exit code $LASTEXITCODE"
    }
}

function Capture-MqttWindow {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [int] $Seconds,
        [scriptblock] $AfterStart
    )

    $output = Join-Path $EvidenceRoot "$Name.log"
    $errorOutput = Join-Path $EvidenceRoot "$Name-error.log"
    $process = Start-Process mosquitto_sub `
        -ArgumentList @("-h", $BrokerHost, "-p", "$BrokerPort", "-t", "resq/#", "-v") `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $output `
        -RedirectStandardError $errorOutput

    Start-Sleep -Milliseconds 500
    if ($AfterStart) {
        & $AfterStart
    }
    Start-Sleep -Seconds $Seconds

    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id
        $process.WaitForExit()
    }
}

function Measure-MqttCapture {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [int] $WindowSeconds
    )

    $rows = Get-Content $Path | ForEach-Object {
        $separator = $_.IndexOf(" ")
        if ($separator -gt 0) {
            $topic = $_.Substring(0, $separator)
            $payload = $_.Substring($separator + 1)
            [pscustomobject]@{
                Topic = $topic
                Payload = $payload
                Bytes = [System.Text.Encoding]::UTF8.GetByteCount($payload)
            }
        }
    }

    $rows |
        Group-Object Topic |
        ForEach-Object {
            $totalBytes = ($_.Group | Measure-Object Bytes -Sum).Sum
            $averageBytes = ($_.Group | Measure-Object Bytes -Average).Average
            $uniquePayloads = ($_.Group.Payload | Sort-Object -Unique).Count
            [pscustomobject]@{
                Topic = $_.Name
                Messages = $_.Count
                MessagesPerSecond = [math]::Round($_.Count / $WindowSeconds, 3)
                MessagesPerMinute = [math]::Round($_.Count * 60 / $WindowSeconds, 2)
                TotalBytes = $totalBytes
                BytesPerSecond = [math]::Round($totalBytes / $WindowSeconds, 2)
                BytesPerMinute = [math]::Round($totalBytes * 60 / $WindowSeconds, 2)
                AveragePayloadBytes = [math]::Round($averageBytes, 2)
                UniquePayloads = $uniquePayloads
            }
        } |
        Sort-Object TotalBytes -Descending
}

$health = Invoke-RestMethod "$BackendBaseUrl/api/hub/health"
$health | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $EvidenceRoot "phase-03-health.json")

$simulatorOutput = Join-Path $EvidenceRoot "phase-03-simulator.log"
$simulatorError = Join-Path $EvidenceRoot "phase-03-simulator-error.log"
$simulatorProcess = Start-Process node `
    -ArgumentList @(
        $Simulator,
        "--device-id", $DeviceId,
        "--session-id", $SessionId,
        "--mqtt-url", "mqtt://127.0.0.1:1883",
        "--telemetry-interval-ms", "200",
        "--heartbeat-interval-ms", "1000",
        "--quiet"
    ) `
    -WorkingDirectory $LocalHubRoot `
    -PassThru `
    -WindowStyle Hidden `
    -RedirectStandardOutput $simulatorOutput `
    -RedirectStandardError $simulatorError

try {
    # On a busy validation host, Node module loading can take several seconds.
    # Wait until after the simulator has had time to connect and subscribe so the
    # first non-retained command is not lost.
    Start-Sleep -Seconds 10

    if (-not $SkipIdle -and -not $OnlySensor) {
        Capture-MqttWindow -Name "phase-03-idle-120s" -Seconds 120
    }

    Capture-MqttWindow -Name "phase-03-sensor-stream-60s" -Seconds 60 -AfterStart {
        Publish-MqttJson -Topic "resq/$DeviceId/cmd/telemetry" -Payload @{
            request_id = "phase03-telemetry-start"
            issued_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            action = "START"
            interval_ms = 200
        }
    }
    Publish-MqttJson -Topic "resq/$DeviceId/cmd/telemetry" -Payload @{
        request_id = "phase03-telemetry-stop"
        issued_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        action = "STOP"
    }

    if (-not $OnlySensor) {
        Capture-MqttWindow -Name "phase-03-calibration-120s" -Seconds 120 -AfterStart {
            Publish-MqttJson -Topic "resq/$DeviceId/cmd/calibration/start" -Payload @{
                request_id = "phase03-calibration-start"
                issued_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                hall_delta = 1000
                ref_pressure = 100
                bladder_1_pressure = 100
                bladder_2_pressure = 100
                profile_id = "adult-basic"
            }
        }

        Capture-MqttWindow -Name "phase-03-active-session-120s" -Seconds 120 -AfterStart {
            Publish-MqttJson -Topic "resq/$DeviceId/cmd/session/start" -Payload @{
                request_id = "phase03-session-start"
                issued_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
                session_id = $SessionId
                profile_id = "adult-basic"
            }
        }
        Publish-MqttJson -Topic "resq/$DeviceId/cmd/session/stop" -Payload @{
            request_id = "phase03-session-stop"
            issued_at_ms = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
            session_id = $SessionId
        }
    }

    $captures = @(
        @{ Name = "phase-03-idle-120s"; Seconds = 120 },
        @{ Name = "phase-03-sensor-stream-60s"; Seconds = 60 },
        @{ Name = "phase-03-calibration-120s"; Seconds = 120 },
        @{ Name = "phase-03-active-session-120s"; Seconds = 120 }
    )

    $allMetrics = foreach ($capture in $captures) {
        $metrics = Measure-MqttCapture `
            -Path (Join-Path $EvidenceRoot "$($capture.Name).log") `
            -WindowSeconds $capture.Seconds
        $metrics |
            Format-Table -AutoSize |
            Out-String -Width 240 |
            Set-Content -Encoding utf8 (Join-Path $EvidenceRoot "$($capture.Name)-metrics.txt")
        foreach ($metric in $metrics) {
            $metric | Add-Member -NotePropertyName Window -NotePropertyValue $capture.Name -PassThru
        }
    }
    $allMetrics |
        Select-Object Window,Topic,Messages,MessagesPerSecond,MessagesPerMinute,TotalBytes,BytesPerSecond,BytesPerMinute,AveragePayloadBytes,UniquePayloads |
        ConvertTo-Json -Depth 5 |
        Set-Content -Encoding utf8 (Join-Path $EvidenceRoot "phase-03-mqtt-metrics.json")

    $apiResults = foreach ($endpoint in @("/api/hub/health", "/api/manikins/live", "/api/sessions")) {
        try {
            $response = Invoke-WebRequest "$BackendBaseUrl$endpoint" -UseBasicParsing
            [pscustomobject]@{
                Endpoint = $endpoint
                Status = [int] $response.StatusCode
                Bytes = [Text.Encoding]::UTF8.GetByteCount($response.Content)
            }
        }
        catch {
            $status = if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { "ERROR" }
            [pscustomobject]@{
                Endpoint = $endpoint
                Status = $status
                Bytes = 0
            }
        }
    }
    $apiResults |
        Format-Table -AutoSize |
        Out-String -Width 160 |
        Set-Content -Encoding utf8 (Join-Path $EvidenceRoot "phase-03-api-size-baseline.txt")
}
finally {
    if ($simulatorProcess -and -not $simulatorProcess.HasExited) {
        Stop-Process -Id $simulatorProcess.Id
    }
}

Set-Content -Encoding ascii -Path (Join-Path $EvidenceRoot "phase-03-capture-complete.txt") -Value "PASS"

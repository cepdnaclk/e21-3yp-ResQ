param(
    [string]$BrokerHost = "127.0.0.1",
    [int]$BrokerPort = 1883,
    [string]$DeviceId = "M01",
    [string]$SessionId = "S-TEST-001",
    [int]$Seq = 1,
    [ValidateSet("metric-first", "raw", "debugRaw", "wrong-session", "wrong-device", "ended-session", "malformed", "incomplete", "heartbeat", "status")]
    [string]$Sample = "metric-first",
    [string]$EndedSessionId = "S-ENDED-001",
    [switch]$PrintPayload
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command mosquitto_pub -ErrorAction SilentlyContinue)) {
    throw "mosquitto_pub was not found on PATH. Install Mosquitto clients or add mosquitto_pub.exe to PATH."
}

$topicDeviceId = $DeviceId
$topicKind = "telemetry"

switch ($Sample) {
    "metric-first" {
        $payload = @{
            deviceId = $DeviceId
            sessionId = $SessionId
            seq = $Seq
            tsMs = 12345678
            depthMm = 52
            rateCpm = 110
            recoilOk = $true
            pauseS = 0.2
            compressionCount = 18
            handPlacement = "CENTER"
            flags = @("DEPTH_OK", "RATE_OK", "RECOIL_OK")
            sourceMode = "simulator"
        } | ConvertTo-Json -Depth 8
    }
    "raw" {
        $payload = @{
            device_id = $DeviceId
            session_id = $SessionId
            seq = $Seq
            force1 = 120000
            force2 = 118000
            hall_raw = 3420
            current_delta = 52
            total_compressions = 18
            feedback = "PERFECT"
        } | ConvertTo-Json -Depth 8
    }
    "debugRaw" {
        $payload = @{
            deviceId = $DeviceId
            sessionId = $SessionId
            seq = $Seq
            depthMm = 50
            rateCpm = 108
            recoilOk = $true
            pauseS = 0.1
            compressionCount = 4
            handPlacement = "CENTER"
            flags = @("DEPTH_OK")
            debugRaw = @{
                hallRaw = 3420
                force1Raw = 120000
                force2Raw = 118500
            }
        } | ConvertTo-Json -Depth 8
    }
    "wrong-session" {
        $payload = @{
            deviceId = $DeviceId
            sessionId = "S-WRONG-001"
            seq = $Seq
            depthMm = 52
            rateCpm = 110
            recoilOk = $true
            pauseS = 0.2
            compressionCount = 18
            handPlacement = "CENTER"
            flags = @("DEPTH_OK")
            sourceMode = "simulator"
        } | ConvertTo-Json -Depth 8
    }
    "wrong-device" {
        $payload = @{
            deviceId = "$DeviceId-WRONG"
            sessionId = $SessionId
            seq = $Seq
            depthMm = 52
            rateCpm = 110
            recoilOk = $true
            pauseS = 0.2
            compressionCount = 18
            handPlacement = "CENTER"
            flags = @("DEPTH_OK")
            sourceMode = "simulator"
        } | ConvertTo-Json -Depth 8
    }
    "ended-session" {
        $payload = @{
            deviceId = $DeviceId
            sessionId = $EndedSessionId
            seq = $Seq
            depthMm = 52
            rateCpm = 110
            recoilOk = $true
            pauseS = 0.2
            compressionCount = 18
            handPlacement = "CENTER"
            flags = @("DEPTH_OK")
            sourceMode = "simulator"
        } | ConvertTo-Json -Depth 8
    }
    "malformed" {
        $payload = "{ ""deviceId"": ""$DeviceId"", ""sessionId"": "
    }
    "incomplete" {
        $payload = @{
            deviceId = $DeviceId
            sessionId = $SessionId
            seq = $Seq
            compressionCount = 18
            handPlacement = "CENTER"
        } | ConvertTo-Json -Depth 8
    }
    "heartbeat" {
        $topicKind = "heartbeat"
        $payload = @{
            deviceId = $DeviceId
            sessionId = $SessionId
            tsMs = 12345678
            battery = 92
            rssi = -60
        } | ConvertTo-Json -Depth 8
    }
    "status" {
        $topicKind = "status"
        $payload = @{
            deviceId = $DeviceId
            sessionId = $SessionId
            tsMs = 12345678
            status = "ready"
            sessionActive = $true
        } | ConvertTo-Json -Depth 8
    }
}

$topic = "resq/manikins/$topicDeviceId/$topicKind"
$payloadFile = Join-Path $env:TEMP "resq-live-$Sample-$PID.json"
Set-Content -LiteralPath $payloadFile -Value $payload -Encoding UTF8

if ($PrintPayload) {
    Write-Host "Topic: $topic"
    Write-Host $payload
}

& mosquitto_pub -h $BrokerHost -p $BrokerPort -t $topic -f $payloadFile
Remove-Item -LiteralPath $payloadFile -Force
Write-Host "Published $Sample to $topic"

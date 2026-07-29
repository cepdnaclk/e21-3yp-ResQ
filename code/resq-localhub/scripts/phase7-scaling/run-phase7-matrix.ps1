[CmdletBinding()]
param(
    [int[]]$Counts = @(1, 5, 10, 20),
    [switch]$Smoke,
    [switch]$IncludeSoak,
    [string]$OutputRoot = "",
    [string]$Jar = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptRoot "..\..\..\..")).Path
$harness = Join-Path $scriptRoot "phase7-load-harness.js"

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot "docs\integration-checkup\2026-07-28\phase-07-runs\matrix"
}
$OutputRoot = [System.IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null

$durations = if ($Smoke) {
    @{
        "idle" = 5
        "session" = 8
        "mixed" = 8
        "command-burst" = 6
        "reconnect" = 15
    }
} else {
    @{
        "idle" = 600
        "session" = 600
        "mixed" = 900
        "command-burst" = 60
        "reconnect" = 300
    }
}

$scenarios = @("idle", "session", "mixed", "command-burst", "reconnect")
$runs = [System.Collections.Generic.List[object]]::new()
$startedAt = [DateTimeOffset]::UtcNow

foreach ($count in $Counts) {
    if ($count -notin @(1, 5, 10, 20)) {
        throw "Phase 7 matrix count must be one of 1, 5, 10, or 20."
    }
    foreach ($scenario in $scenarios) {
        $runId = "{0}-{1}-{2}" -f $count, $scenario, ([DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssZ"))
        $runOutput = Join-Path $OutputRoot $runId
        $arguments = @(
            $harness,
            "--devices", [string]$count,
            "--scenario", $scenario,
            "--duration-seconds", [string]$durations[$scenario],
            "--run-id", $runId,
            "--output-dir", $runOutput
        )
        if (-not [string]::IsNullOrWhiteSpace($Jar)) {
            $arguments += @("--jar", [System.IO.Path]::GetFullPath($Jar))
        }

        $runStartedAt = [DateTimeOffset]::UtcNow
        & node @arguments
        $runExitCode = $LASTEXITCODE
        $runs.Add([pscustomobject]@{
            runId = $runId
            devices = $count
            scenario = $scenario
            requiredDurationSeconds = $durations[$scenario]
            startedAt = $runStartedAt.ToString("o")
            endedAt = [DateTimeOffset]::UtcNow.ToString("o")
            exitCode = $runExitCode
            result = Join-Path $runOutput "result.json"
            failure = Join-Path $runOutput "failure.json"
        })
    }
}

if ($IncludeSoak) {
    $soakDuration = if ($Smoke) { 36 } else { 3600 }
    $runId = "20-soak-{0}" -f ([DateTimeOffset]::UtcNow.ToString("yyyyMMddTHHmmssZ"))
    $runOutput = Join-Path $OutputRoot $runId
    $arguments = @(
        $harness,
        "--devices", "20",
        "--scenario", "soak",
        "--duration-seconds", [string]$soakDuration,
        "--run-id", $runId,
        "--output-dir", $runOutput
    )
    if (-not [string]::IsNullOrWhiteSpace($Jar)) {
        $arguments += @("--jar", [System.IO.Path]::GetFullPath($Jar))
    }
    $runStartedAt = [DateTimeOffset]::UtcNow
    & node @arguments
    $runExitCode = $LASTEXITCODE
    $runs.Add([pscustomobject]@{
        runId = $runId
        devices = 20
        scenario = "soak"
        requiredDurationSeconds = $soakDuration
        startedAt = $runStartedAt.ToString("o")
        endedAt = [DateTimeOffset]::UtcNow.ToString("o")
        exitCode = $runExitCode
        result = Join-Path $runOutput "result.json"
        failure = Join-Path $runOutput "failure.json"
    })
}

$summary = [pscustomobject]@{
    schemaVersion = 1
    smoke = [bool]$Smoke
    startedAt = $startedAt.ToString("o")
    endedAt = [DateTimeOffset]::UtcNow.ToString("o")
    requestedCounts = $Counts
    includedSoak = [bool]$IncludeSoak
    passedRuns = @($runs | Where-Object { $_.exitCode -eq 0 }).Count
    failedRuns = @($runs | Where-Object { $_.exitCode -ne 0 }).Count
    runs = $runs
}
$summaryPath = Join-Path $OutputRoot "matrix-summary.json"
$summary | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $summaryPath -Encoding UTF8
Write-Host "Phase 7 matrix summary: $summaryPath"

if ($summary.failedRuns -gt 0) {
    exit 2
}

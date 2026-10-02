$ErrorActionPreference = 'Stop'
# Build a self-contained runtime from the release builder's JDK; never use a
# developer's JAVA_HOME on the installed machine. Include all JDK modules to
# retain reflection, TLS providers and SQLite JNI support.
$desktopDir = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../apps/localhub-desktop'))
$resourcesDir = Join-Path $desktopDir 'src-tauri/resources'
$runtimeDir = [IO.Path]::GetFullPath((Join-Path $resourcesDir 'jre'))
$jdkDir = $env:JAVA_HOME
if (-not $jdkDir) {
    $jdkDir = Split-Path (Split-Path (Get-Command java.exe -ErrorAction Stop).Source)
}
$jlink = Join-Path $jdkDir 'bin/jlink.exe'
if (-not (Test-Path -LiteralPath $jlink)) { throw 'A JDK 17 or newer with jlink is required to build the bundled runtime.' }
if ($runtimeDir -ne [IO.Path]::GetFullPath((Join-Path $desktopDir 'src-tauri/resources/jre'))) {
    throw 'Refusing to replace a runtime outside the release resources.'
}
if (Test-Path -LiteralPath $runtimeDir) { Remove-Item -LiteralPath $runtimeDir -Recurse -Force }
& $jlink --module-path (Join-Path $jdkDir 'jmods') --add-modules ALL-MODULE-PATH --strip-debug --no-header-files --no-man-pages --output $runtimeDir
if ($LASTEXITCODE -ne 0) { throw "jlink failed with exit code $LASTEXITCODE" }
foreach ($binary in @('java.exe', 'javaw.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $runtimeDir "bin/$binary"))) { throw "Bundled runtime is missing $binary" }
}
& (Join-Path $runtimeDir 'bin/java.exe') -version
if ($LASTEXITCODE -ne 0) { throw 'Bundled Java runtime validation failed.' }

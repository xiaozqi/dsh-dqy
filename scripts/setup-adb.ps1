$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$vendorDir = Join-Path $projectRoot 'vendor'
$platformToolsDir = Join-Path $vendorDir 'platform-tools'
$zipPath = Join-Path $vendorDir 'platform-tools.zip'
$downloadUrl = 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'

if (Test-Path (Join-Path $platformToolsDir 'adb.exe')) {
    Write-Output "platform-tools already installed at $platformToolsDir"
}
else {
    New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null
    Write-Output "downloading platform-tools..."
    Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $vendorDir -Force
    Remove-Item $zipPath -Force
    Write-Output "installed at $platformToolsDir"
}

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($userPath -notlike "*$platformToolsDir*") {
    [Environment]::SetEnvironmentVariable('Path', "$userPath;$platformToolsDir", 'User')
    Write-Output "added to user PATH (restart terminal to take effect)"
}

& (Join-Path $platformToolsDir 'adb.exe') version

param(
    [string]$AdbPath = ""
)

$ErrorActionPreference = 'Stop'

'---- installing uiautomator2 ----'
python -m pip install --disable-pip-version-check -i https://mirrors.huaweicloud.com/repository/pypi/simple uiautomator2

if ($AdbPath -and (Test-Path $AdbPath)) {
    $adbDir = Split-Path -Parent $AdbPath
    $env:PATH = "$adbDir;$env:PATH"
    Write-Output "injected adb dir into PATH for this session: $adbDir"
}

'---- initializing uiautomator2 on device (python -m uiautomator2 init) ----'
python -m uiautomator2 init

'---- verify ----'
python -c "import uiautomator2 as u2; print('uiautomator2 ok')"

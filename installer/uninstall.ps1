# Removes Enki Browser for the current user. Browsing data (profile, history, Enki settings) is
# kept unless -RemoveData is given, so reinstalling picks up where the user left off.
param([switch]$RemoveData)
$ErrorActionPreference = "Stop"
$target = Join-Path $env:LOCALAPPDATA "Programs\EnkiBrowser"
$data = Join-Path $env:LOCALAPPDATA "EnkiBrowser"

Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" } | Stop-Process -Force
Start-Sleep -Seconds 1
foreach ($lnk in @(
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Enki Browser.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Enki Browser.lnk"))) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
}
Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EnkiBrowser" -Recurse -Force -ErrorAction SilentlyContinue
# The script lives inside the folder it deletes; hand the last step to a detached process.
Start-Process -WindowStyle Hidden cmd.exe -ArgumentList "/c timeout /t 2 >nul & rmdir /s /q `"$target`""
if ($RemoveData -and (Test-Path $data)) { Remove-Item $data -Recurse -Force }
Write-Host "Enki Browser removed.$(if (-not $RemoveData) { " Your browsing data is kept in $data." })"

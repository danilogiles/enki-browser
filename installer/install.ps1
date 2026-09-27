# Installs Enki Browser for the current user. No administrator rights needed: files go to
# %LOCALAPPDATA%\Programs\EnkiBrowser, shortcuts to the Start menu and desktop, and the
# uninstall entry to the current user's registry so it shows up in Settings > Apps.
param([switch]$NoDesktopShortcut, [switch]$Quiet)
$ErrorActionPreference = "Stop"

$source = $PSScriptRoot
$target = Join-Path $env:LOCALAPPDATA "Programs\EnkiBrowser"
$version = (Get-Content (Join-Path $source "version.json") -Raw | ConvertFrom-Json)

if ((Resolve-Path $source).Path -ne $target) {
    # A running browser holds its files open; ask before closing it rather than failing halfway.
    $running = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$target\*" }
    if ($running) {
        if (-not $Quiet) { Write-Host "Enki Browser is running and will be closed to update it." }
        $running | Stop-Process -Force
        Start-Sleep -Seconds 1
    }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    # Remove the previous program files but never the profile, which lives elsewhere.
    Get-ChildItem $target -Force | Where-Object { $_.Name -ne "User Data" } | Remove-Item -Recurse -Force
    Copy-Item -Path (Join-Path $source "*") -Destination $target -Recurse -Force
}

$launcher = Join-Path $target "EnkiBrowser.exe"
$icon = Join-Path $target "enki.ico"
$shell = New-Object -ComObject WScript.Shell
function New-Shortcut($path) {
    $s = $shell.CreateShortcut($path)
    $s.TargetPath = $launcher
    $s.WorkingDirectory = $target
    $s.IconLocation = $icon
    $s.Description = "Enki Browser"
    $s.Save()
}
New-Shortcut (Join-Path ([Environment]::GetFolderPath("Programs")) "Enki Browser.lnk")
if (-not $NoDesktopShortcut) { New-Shortcut (Join-Path ([Environment]::GetFolderPath("Desktop")) "Enki Browser.lnk") }

$key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EnkiBrowser"
New-Item -Path $key -Force | Out-Null
$values = @{
    DisplayName     = "Enki Browser"
    DisplayVersion  = "$($version.enkiBrowser)"
    Publisher       = "Enki contributors"
    DisplayIcon     = $icon
    InstallLocation = $target
    URLInfoAbout    = "https://github.com/danilogiles/enki-browser"
    UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$target\uninstall.ps1`""
}
foreach ($name in $values.Keys) { Set-ItemProperty -Path $key -Name $name -Value $values[$name] }
Set-ItemProperty -Path $key -Name NoModify -Value 1 -Type DWord
Set-ItemProperty -Path $key -Name NoRepair -Value 1 -Type DWord

if (-not $Quiet) {
    Write-Host "Enki Browser $($version.enkiBrowser) (Chromium $($version.chromium)) installed to $target"
    Start-Process $launcher
}

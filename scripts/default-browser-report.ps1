# Read-only report: what Windows knows about Enki Browser and Chromium as browsers and "Open with"
# apps, for the current user. For each ProgID, protocol class, Applications entry and browser
# client that mentions Chromium or Enki, it shows the DefaultIcon, the open command and the app
# icon, and whether the file each one names still exists (an entry naming a deleted
# app\<version>\chromium\chrome.exe is what shows a blank icon). Then the user's choices for
# links and web files, RegisteredApplications and the MuiCache names.
#
# It changes nothing: it only reads the registry and checks that files exist.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\default-browser-report.ps1 > enki-default-browser.txt
$ErrorActionPreference = 'SilentlyContinue'
$hkcu = 'Registry::HKEY_CURRENT_USER'
$hklm = 'Registry::HKEY_LOCAL_MACHINE'
$classes = "$hkcu\Software\Classes"
$match = 'chromium|enki'

function Get-Value([string]$path, [string]$name) {
  $key = Get-Item -LiteralPath $path
  if ($key) { $key.GetValue($name, $null, 'DoNotExpandEnvironmentNames') } else { $null }
}

# The executable a command or icon location names: a quoted first token, else up to ".exe".
function Get-Exe([string]$value) {
  if (-not $value) { return $null }
  $v = [Environment]::ExpandEnvironmentVariables($value.Trim())
  if ($v.StartsWith('"')) { $close = $v.IndexOf('"', 1); if ($close -gt 1) { return $v.Substring(1, $close - 1) } else { return $null } }
  $exe = $v.ToLower().IndexOf('.exe'); if ($exe -gt 0) { return $v.Substring(0, $exe + 4) }
  $comma = $v.LastIndexOf(','); if ($comma -gt 0) { return $v.Substring(0, $comma) }
  return $v
}

function Show([string]$label, $value) {
  if ($null -eq $value) { return }
  $exe = Get-Exe $value
  $state = if (-not $exe) { '' } elseif (Test-Path -LiteralPath $exe) { 'exists' } else { 'FILE MISSING' }
  '    {0,-20} {1}   [{2}]' -f $label, $value, $state
}

function Report-Key([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  '  ' + ($path -replace '^Registry::', '')
  $name = Get-Value $path ''; if ($name) { '    {0,-20} {1}' -f '(default)', $name }
  $friendly = Get-Value $path 'FriendlyAppName'; if ($friendly) { '    {0,-20} {1}' -f 'FriendlyAppName', $friendly }
  Show 'DefaultIcon' (Get-Value "$path\DefaultIcon" '')
  Show 'shell\open\command' (Get-Value "$path\shell\open\command" '')
  Show 'App ApplicationIcon' (Get-Value "$path\Application" 'ApplicationIcon')
  $appName = Get-Value "$path\Application" 'ApplicationName'; if ($appName) { '    {0,-20} {1}' -f 'App ApplicationName', $appName }
  Show 'Capabilities icon' (Get-Value "$path\Capabilities" 'ApplicationIcon')
  $capsName = Get-Value "$path\Capabilities" 'ApplicationName'; if ($capsName) { '    {0,-20} {1}' -f 'Capabilities name', $capsName }
}

function Mentions([string]$path) {
  if ((Split-Path $path -Leaf) -match $match) { return $true }
  foreach ($v in @((Get-Value "$path\DefaultIcon" ''), (Get-Value "$path\shell\open\command" ''))) { if ($v -and $v -match $match) { return $true } }
  return $false
}

"Enki Browser / Chromium registration report  ($(Get-Date -Format 'yyyy-MM-dd HH:mm zzz'), Windows build $(Get-Value "$hklm\SOFTWARE\Microsoft\Windows NT\CurrentVersion" 'CurrentBuildNumber'))"
''
'== Enki Browser installs =='
$uninstall = "$hkcu\Software\Microsoft\Windows\CurrentVersion\Uninstall\EnkiBrowser"
$location = Get-Value $uninstall 'InstallLocation'
if ($location) {
  '  Apps entry: {0} {1}, InstallLocation {2}' -f (Get-Value $uninstall 'DisplayName'), (Get-Value $uninstall 'DisplayVersion'), $location
  $current = Get-Content -LiteralPath (Join-Path $location 'current') -ErrorAction SilentlyContinue
  '  current = {0}; version folders: {1}' -f $current, ((Get-ChildItem -LiteralPath (Join-Path $location 'app') -Directory | ForEach-Object Name) -join ', ')
  '  portable file: {0}' -f (Test-Path -LiteralPath (Join-Path $location 'portable'))
} else { '  no Apps entry (not installed with the installer, or installed elsewhere)' }
''

'== ProgIDs and protocol classes under HKCU\Software\Classes that mention Chromium or Enki =='
foreach ($key in Get-ChildItem -LiteralPath $classes) {
  if ($key.PSChildName.StartsWith('.') -or $key.PSChildName -eq 'Applications') { continue }
  $path = "$classes\$($key.PSChildName)"
  if (Mentions $path) { Report-Key $path }
}
''

'== "Open with" applications (HKCU\Software\Classes\Applications) that mention Chromium or Enki =='
foreach ($key in Get-ChildItem -LiteralPath "$classes\Applications") {
  $path = "$classes\Applications\$($key.PSChildName)"
  if (Mentions $path) { Report-Key $path }
}
''

'== Browser clients (StartMenuInternet) =='
foreach ($hive in @($hkcu, $hklm)) {
  foreach ($key in Get-ChildItem -LiteralPath "$hive\Software\Clients\StartMenuInternet") { Report-Key "$hive\Software\Clients\StartMenuInternet\$($key.PSChildName)" }
}
''

'== RegisteredApplications that mention Chromium or Enki =='
foreach ($hive in @($hkcu, $hklm)) {
  $reg = Get-Item -LiteralPath "$hive\Software\RegisteredApplications"
  if (-not $reg) { continue }
  foreach ($name in $reg.GetValueNames()) {
    $target = $reg.GetValue($name)
    if ($name -notmatch $match -and $target -notmatch $match) { continue }
    $exists = Test-Path -LiteralPath "$hive\$target"
    '  {0}  {1} = {2}   [{3}]' -f ($hive -replace '^Registry::', ''), $name, $target, $(if ($exists) { 'key exists' } else { 'KEY MISSING' })
  }
}
''

'== The choices for links (UserChoice; read-only, protected by Windows) =='
foreach ($scheme in @('http', 'https')) {
  $base = "$hkcu\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\$scheme"
  '  {0,-6} UserChoice {1}   UserChoiceLatest {2}' -f $scheme, (Get-Value "$base\UserChoice" 'ProgId'), ((Get-Value "$base\UserChoiceLatest\ProgId" 'ProgId'), (Get-Value "$base\UserChoiceLatest" 'ProgId') | Where-Object { $_ } | Select-Object -First 1)
}
''

'== Web files: Open with lists and choices =='
foreach ($ext in @('.htm', '.html', '.shtml', '.xhtml', '.pdf', '.svg', '.webp', '.mhtml')) {
  $fileExts = "$hkcu\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\$ext"
  $progIds = (Get-Item -LiteralPath "$classes\$ext\OpenWithProgids").GetValueNames() -join ', '
  $explorerProgIds = (Get-Item -LiteralPath "$fileExts\OpenWithProgids").GetValueNames() -join ', '
  $list = Get-Item -LiteralPath "$fileExts\OpenWithList"
  $apps = if ($list) { ($list.GetValueNames() | Where-Object { $_ -ne 'MRUList' } | ForEach-Object { $list.GetValue($_) }) -join ', ' } else { '' }
  $choice = (Get-Value "$fileExts\UserChoice" 'ProgId'), (Get-Value "$fileExts\UserChoiceLatest\ProgId" 'ProgId'), (Get-Value "$fileExts\UserChoiceLatest" 'ProgId') | Where-Object { $_ } | Select-Object -First 1
  '  {0}' -f $ext
  '    Classes OpenWithProgids:  {0}' -f $progIds
  '    Explorer OpenWithProgids: {0}' -f $explorerProgIds
  '    Explorer OpenWithList:    {0}' -f $apps
  '    UserChoice:               {0}' -f $choice
}
''

'== MuiCache names that mention Chromium or Enki (the names Windows shows for programs) =='
$mui = Get-Item -LiteralPath "$classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache"
if ($mui) {
  foreach ($name in $mui.GetValueNames()) {
    if ($name -notmatch $match -and "$($mui.GetValue($name))" -notmatch $match) { continue }
    $file = $name -replace '\.(FriendlyAppName|ApplicationCompany)$', ''
    '  {0} = {1}   [{2}]' -f $name, $mui.GetValue($name), $(if (Test-Path -LiteralPath $file) { 'exists' } else { 'FILE MISSING' })
  }
}
''
'Nothing was changed.'

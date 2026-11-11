# Windows test copies (test-isolated)

A private test copy of Enki Browser for Windows — a candidate build someone tries next to the Enki
Browser they already use — starts through `EnkiBrowser.exe` like a normal install (so the
shortcut, taskbar and Task Manager say Enki Browser), but must not touch that install.

The marker is a file named `test-isolated` next to `EnkiBrowser.exe` (`Isolation` in
`launcher/Common.cs`). It only counts when it is what `scripts/windows-test-package.py` writes:
`enki-test-isolated/1`, `label=…`, `token=<32 hex>`, with the same token in
`app\<current>\extensions\shield\test-copy.json`. A stray or hand-made file next to a real
install is ignored and logged in `.update\update.log` ("ignored the test-isolated file …"); updates
go on. Without the file nothing changes.

| Start-up / lifetime side effect | Normal install | test-isolated |
| --- | --- | --- |
| Profile (`--user-data-dir`) | `%LOCALAPPDATA%\EnkiBrowser\User Data` | `<root>\User Data` |
| `NativeHost.Register` (HKCU `Software\Chromium\NativeMessagingHosts\…`, `.update\native-host.json`) | runs | skipped |
| `Install.SyncRegistration` (Apps entry version/publisher; `DefaultBrowser.Register`/`Repair`) | runs (own install only) | skipped |
| Updates: `--enki-update-check`, `Updater.CheckAndStage` (shared `EnkiBrowserUpdater` mutex, download, `current` rewrite), Watcher checks, restart offer | runs unless `no-update` | off (`Updater.Disabled`) |
| `Widevine.UpdateIfDue` (Watcher, only when updates are on) | runs if opted in | skipped |
| `Migration.Run` (Enki defaults in each profile) | main profile | the copy's own profile only |
| `Widevine.Tidy` | main profile | the copy's own profile only |
| `ShellIdentity.RepairShortcuts(root)` (start and close) | runs | runs; only touches shortcuts that open *this copy's* `app\…\chrome.exe` |
| Watcher (per-root mutex; on close `RemoveOldVersions`, `RefreshStub`) | runs | runs; only this copy's folder |
| `--uninstall` | removes shortcuts, HKCU entries, optionally `%LOCALAPPDATA%\EnkiBrowser` | removes only `<root>` (profile inside); never the shared shortcuts, registry or main profile |
| Process identity (stub → launcher → `chromium\chrome.exe`, icon, window class) | unchanged | unchanged |
| First window title | page title | `--window-name=Enki Browser (test copy, updates off)` |

## How Shield knows

`test-copy.json` in the copy's Shield (`shield/testcopy.js`). With it, Shield never calls the
native host at all — the copy registers none, so the host Chromium finds is the real install's — and
never asks GitHub. "Check for updates" (settings, popup, right-click menu), "Restart to update",
the default-browser row and the protected-video buttons are hidden, and the settings page, the
popup and the menu show **Test copy, updates off**.

## The native host refuses other copies' browsers

Defense in depth for copies whose Shield does not know (`HostGuard` in `Common.cs`,
`NativeHost.Refusal`): `check`, `restart`, `open-default-apps`, `widevine-install` and
`widevine-remove` are carried out only when the calling browser is a `chromium\chrome.exe` under
this install's own `app\` folder. The caller is the process owning Chromium's `--parent-window=<HWND>`,
or else the nearest `chrome.exe` among the host's ancestors (Chromium starts hosts through `cmd.exe`).
Unknown callers are refused. A refusal replies `{ unavailable: true, error: "unavailable in this copy" }`
and Shield shows "Unavailable in this copy.". `status`, `default-status` and `widevine-status` (reads)
answer anyone. This protects a real install only once it runs a launcher with this change.

## Assembling a test copy

`scripts/windows-test-package.py <EnkiBrowser-<v>-windows-x64.zip> --label <id>` writes the marker,
Shield's `test-copy.json` (same random token), `no-update`, a `Create-Test-Shortcut.ps1` that
targets `EnkiBrowser.exe` (and checks the token pair first), notes and checksums. It refuses a build
whose launcher or Shield predates this change.

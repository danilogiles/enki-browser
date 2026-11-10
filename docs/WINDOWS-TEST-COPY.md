# Windows test copies (test-isolated)

A private test copy of Enki Browser for Windows — a candidate build someone tries next to the Enki
Browser they already use — starts through `EnkiBrowser.exe` like a normal install (so the
shortcut, taskbar and Task Manager say Enki Browser), but must not touch that install.

A file named `test-isolated` next to `EnkiBrowser.exe` turns this on (`Isolation` in
`launcher/Common.cs`). Without the file nothing changes.

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

`scripts/windows-test-package.py` turns a CI Windows zip into such a copy: it adds `test-isolated`
and `no-update`, a `Create-Test-Shortcut.ps1` that targets `EnkiBrowser.exe`, notes and checksums,
and refuses a build whose launcher predates the marker.

Known limit: the copy does not register its own native host, and Chromium finds hosts by name in
HKCU, so Enki Shield's "Check for updates", "Restart to update", default-browser and protected
video buttons in a test copy would reach the *real* install's host. Don't use them there.

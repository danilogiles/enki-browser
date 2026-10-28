Early alpha. Read *Known gaps* in the README first.

**New in 0.8.13: Linux is back, and auto-update works again.** 0.8.12 shipped for Windows and macOS only, because a release-build bug stopped the Linux build. That is fixed, so this release includes the Linux `.deb` and `linux-x64.tar.gz` again, and the signed update file is back: Windows installs on 0.8.11 or 0.8.12 update to 0.8.13 on their own.

**Since 0.8.12: newer Chromium base.** Windows and Linux run on ungoogled-chromium 156.0.8078.47 and macOS on 155.0.8059.84, with the security fixes in those releases. Linux users get this for the first time in 0.8.13.

**Also since 0.8.12:** Enki can use an AI model running on this computer over plain HTTP (for example `http://localhost`), and a local-network IP address if you allow that exact address in Settings → Model (*Allow HTTP for this local address*). Host names and public addresses over HTTP are refused, and your API key is never sent over HTTP outside this computer. When Act's next step is in a tab in another window, Enki stops and shows a card that explains it only acts in the window you asked from.

**Private windows:** Private windows don't block ads or trackers unless you allow uBlock Origin Lite in Incognito. To turn it on, go to the extensions page, open uBlock Origin Lite's *Details*, and switch on *Allow in Incognito*. While Enki AI setup is still pending, the side panel also offers *Open uBlock settings* as a shortcut.

**Known issue:** video that needs DRM (Netflix, Crunchyroll, Disney+) does not play yet, because the Widevine component is not included. An opt-in download is planned; until then, watch those in another browser.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

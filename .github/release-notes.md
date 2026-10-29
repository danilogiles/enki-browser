Early alpha. Read *Known gaps* in the README first.

**New in 0.8.14: Mac on Chromium 156, safer AI page reads, and Install from the Chrome Web Store.** macOS now runs the same ungoogled-chromium 156.0.8078.47 base as Windows and Linux, with the security fixes in that release.

When Enki's AI reads a page for you, it now asks first before opening an address on your computer or local network that you did not name, or an address it put together after reading web content. If a page redirects somewhere local, Enki stops instead of following. When a page needs JavaScript and opens briefly in a background tab, that tab's requests go out without your cookies or login headers (the tab still uses your profile, so the site's own stored data is still there).

Apps you connect in Settings → Connections (MCP servers) follow the same rule as your AI model: HTTPS for any address, plain HTTP only on this computer, and no redirects, so a sign-in token is never sent over plain HTTP.

On a Chrome Web Store extension page, Enki Shield adds an *Install in Enki* button. A short note comes first (nothing downloads before you click *Continue*), then Chromium's own prompt asks you to confirm. Shield can also check for updates to extensions you installed this way (off by default); when one is ready, *Update* is the main button.

The built-in Enki extension is now version 0.3.8, which carries these AI changes.

**Since 0.8.13:** Linux builds, and signed auto-update for Windows, work as in 0.8.13: Windows installs on 0.8.11 or later update to 0.8.14 on their own.

**Private windows:** Private windows don't block ads or trackers unless you allow uBlock Origin Lite in Incognito. To turn it on, go to the extensions page, open uBlock Origin Lite's *Details*, and switch on *Allow in Incognito*. While Enki AI setup is still pending, the side panel also offers *Open uBlock settings* as a shortcut.

**Known issue:** video that needs DRM (Netflix, Crunchyroll, Disney+) does not play yet, because the Widevine component is not included. An opt-in download is planned; until then, watch those in another browser.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

Early alpha. Read *Known gaps* in the README first.

**New in 0.8.10: AI search.** In the side panel, Settings now lets you choose where searches typed in the address bar go:
- **DuckDuckGo (Default):** searches go to DuckDuckGo, under its privacy policy. Enki doesn't see them. This stays the default until you choose otherwise.
- **Enki AI:** searches go to your AI provider. Only what you type is sent, not your tabs or history. Your provider may search the web to answer. A search is sent only when you press Enter, and suggestions are off. Until setup is finished, searches go to DuckDuckGo.
- **Other:** searches go straight to that engine, under its own privacy policy. Enki doesn't see them. Use *Open search engine settings* to pick it.

**Also new:** Global Privacy Control is on by default, Shield skips AMP pages, tracking parameters are removed from links, and Shield and the side panel are now in Portuguese and Spanish.

**Private windows:** Private windows don't block ads or trackers unless you allow uBlock Origin Lite in Incognito. To turn it on, go to the extensions page, open uBlock Origin Lite's *Details*, and switch on *Allow in Incognito*. While Enki AI setup is still pending, the side panel also offers *Open uBlock settings* as a shortcut.

**Known issue:** video that needs DRM (Netflix, Crunchyroll, Disney+) does not play yet, because the Widevine component is not included. An opt-in download is planned; until then, watch those in another browser.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

Early alpha. Read *Known gaps* in the README first.

**New in 0.8.15: mute tabs with one click, "Always allow" for sites Enki opens, and Enki Home that stays with its window.** Click the speaker icon on a tab that is playing sound to mute it, and click again to unmute. Before, that click only switched to the tab, and muting meant right-click → *Mute site*.

When Enki's AI (Act mode) wants to go to another website, the confirm card now has an *Always allow {site}* box. Tick it and click *Allow*, and Enki goes to that exact site (for example `www.reddit.com`, not all of reddit.com) without asking next time. It only covers plain "go to" and "open new tab" steps. It never applies to clicks, forms, sending, downloads, account pages, passwords or payments. Enki never offers the box for addresses on your computer or local network, plain-HTTP sites, private windows, or steps a web page asked for. The box starts unticked every time, and the site is saved only if the tab really lands there. See and remove saved sites in Settings → *Allowed sites*. Shields *Burn*, *Shred* and burn-when-the-browser-closes also clear the whole list.

If you drag a tab with Enki Home into a new window, *Ask Enki* now opens the side panel in that new window and works on its tabs, instead of going back to the window the tab came from.

The built-in Enki extension is now version 0.3.9, and Enki Shield is 1.2.10, which carry these changes.

**Since 0.8.14:** Linux builds, and signed auto-update for Windows, work as in 0.8.14: Windows installs on 0.8.11 or later update to 0.8.15 on their own.

**Private windows:** Private windows don't block ads or trackers unless you allow uBlock Origin Lite in Incognito. To turn it on, go to the extensions page, open uBlock Origin Lite's *Details*, and switch on *Allow in Incognito*. While Enki AI setup is still pending, the side panel also offers *Open uBlock settings* as a shortcut.

**Known issue:** video that needs DRM (Netflix, Crunchyroll, Disney+) does not play yet, because the Widevine component is not included. An opt-in download is planned; until then, watch those in another browser.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

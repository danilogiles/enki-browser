Early alpha. Read *Known gaps* in the README first.

**New in 0.8.11: safer Act.** Text from web pages now reaches your AI model clearly marked as page content, so the model can tell it apart from what you wrote. This lowers the risk of a page giving Act instructions; Act still asks before sensitive steps. Act asks before it submits a form, sends a message or does other sensitive steps, and when a form's destination can't be told, the confirm card says so in amber. A search box on the same site still goes through without asking.

**Fixed:** Act started from Enki Home now runs in the window you typed it in, not in another open window's side panel.

**Also new:** *Attach a screenshot to every message* is now off by default and is turned off once for profiles that had it on; you can turn it back on in Settings. Enki still takes a screenshot when it needs to see the page. Charts and mind maps in Enki's answers work with the keyboard and screen readers. The privacy policy (Version 6) now lists every host the browser contacts on its own and the exact permissions of its built-in extensions, and a test checks both.

**Private windows:** Private windows don't block ads or trackers unless you allow uBlock Origin Lite in Incognito. To turn it on, go to the extensions page, open uBlock Origin Lite's *Details*, and switch on *Allow in Incognito*. While Enki AI setup is still pending, the side panel also offers *Open uBlock settings* as a shortcut.

**Known issue:** video that needs DRM (Netflix, Crunchyroll, Disney+) does not play yet, because the Widevine component is not included. An opt-in download is planned; until then, watch those in another browser.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

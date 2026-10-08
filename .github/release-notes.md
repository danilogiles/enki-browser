Early alpha. Read *Known gaps* in the README first.

**Windows** — run `EnkiBrowserSetup-<version>.exe` (it also upgrades older installs, keeping your profile). The Windows installer is now signed, with verified publisher Danilo De Souza. For the first few days SmartScreen may still show a warning, until the signature builds reputation. Without an installer: the `windows-x64.zip` is the same browser, portable; or with Scoop:
`scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json`

**macOS 12+** — `macos-arm64.dmg` for Apple silicon (M1 and later), `macos-x64.dmg` for Intel. Drag Enki Browser to Applications. Not notarized yet: the first time, open System Settings → Privacy & Security and click *Open Anyway* (README, "macOS").

**Linux (x86_64)** — Ubuntu/Debian: `sudo apt install ./enki-browser_<version>_amd64.deb`. Any distro, no root: extract the `linux-x64.tar.gz` and run `./enki-browser/install.sh`, or in one line:
`curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh | bash`

Check every download against its `.sha256`. Windows installs update themselves with signed releases; on macOS and Linux, install the new release the same way.

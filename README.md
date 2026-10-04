# Enki Browser

**A private, open-source Chromium browser with an AI assistant built in. Bring your own model.**

Enki Browser is [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
— Chromium without Google's services or telemetry — with the [Enki](https://github.com/danilogiles/enkibrowser)
assistant in the side panel, a tracker blocker on by default, and privacy defaults in the spirit
of Brave and DuckDuckGo. The assistant reads the page you are on and, when you let it, navigates,
clicks and types for you — with the model *you* choose: Claude, GPT, Gemini, a local Ollama model,
or free models through OmniRoute.

> **Status: early alpha, Windows x64 and Linux x64.** It works and is verified end to end (below),
> but it is young: read [Known gaps](#known-gaps) before making it your main browser.

## Install

Everything is on the [Releases](https://github.com/danilogiles/enki-browser/releases) page; check
each download against the `.sha256` file next to it. Then click the Enki icon in the toolbar (or
press `Ctrl+Shift+E`) and choose a model in the panel's Settings — the default, NVIDIA Nemotron,
needs only a free key.

### Windows

| How | |
|---|---|
| **Installer** | Run `EnkiBrowserSetup-<version>.exe`. No administrator rights: it installs for your user into `%LOCALAPPDATA%\Programs\EnkiBrowser`, adds Start menu and desktop shortcuts, appears in *Settings → Apps*, and upgrades older installs keeping your profile. Silent: `/S`; another folder: `/D=<folder>`. |
| **Scoop** | `scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json` — no installer runs; Scoop keeps it updated (`scoop update enki-browser`). |
| **Portable** | Extract `EnkiBrowser-<version>-windows-x64.zip` anywhere and run `EnkiBrowser.exe`. With an empty file named `portable` next to it, the profile lives in that folder too. |

> **Antivirus warnings.** Releases are not yet code-signed (see [Code signing](#code-signing)).
> Windows SmartScreen will say the app is unrecognised — check the SHA-256, then *More info →
> Run anyway* — and a behaviour-based antivirus may distrust an unsigned program that starts a
> browser with extensions and installs updates: Bitdefender quarantined early releases.

### Linux (x86_64)

| How | |
|---|---|
| **Ubuntu, Debian** | `sudo apt install ./enki-browser_<version>_amd64.deb` — installs under `/opt` with a menu entry, and sets up the AppArmor profile Ubuntu 23.10+ needs for Chromium's sandbox. Remove with `sudo apt remove enki-browser`. |
| **Any distro, no root** | Extract `enki-browser-<version>-linux-x64.tar.gz` and run `./enki-browser/install.sh` (into `~/.local`, with a menu entry). On Ubuntu 23.10+, run it once with `--apparmor` (asks for sudo for the sandbox profile). `uninstall.sh` removes it. |
| **One line** | `curl -fsSL https://raw.githubusercontent.com/danilogiles/enki-browser/main/packaging/linux/get-enki-browser.sh \| bash` — downloads the newest release, checks its SHA-256 and runs `install.sh`. |

Tested on Ubuntu 24.04 and Debian 12.

## Updates

On Windows, Enki Browser updates itself (on Linux, install the new release the same way you
installed it; Scoop installs are updated by Scoop). While the browser is open it looks for a newer
release every couple of hours, downloads it and installs it **beside the one you are using**. A
notification then offers to restart now: every window and tab comes back, on the new version. If
you ignore it, the next time you start Enki Browser you are on the new version anyway. Nothing
restarts without your click. Your profile, history and Enki settings are untouched.

How it is laid out, and why:

```
EnkiBrowser.exe     opens the version named in `current`; updates never replace it
current             e.g. 0.5.0
app\0.5.0\          one complete release (Chromium, extensions, launcher)
app\0.5.1\          the next one, added by an update
```

An update only ever **adds** a folder and then rewrites `current`. Nothing that exists is renamed,
moved or overwritten, and no running file is touched — so it can install while you browse, and it
does not look like the self-replacing programs antivirus software hunts for. The previous version
stays for rollback; older ones are removed once nothing runs from them.

An update is installed only if:

- its `update.json` carries a valid **RSA-3072 signature** from the release key. That key exists
  only as a secret in this repository's CI; the launcher trusts nothing else, so a tampered
  download or a compromised release page cannot push code to you;
- the zip's SHA-256 matches the one in that signed manifest;
- its version is **newer** than the one installed (no downgrades).

`.update\update.log` in the install folder records every check. To turn updates off, create an
empty file named `no-update` next to `EnkiBrowser.exe`.

## Code signing

The build signs `EnkiBrowser.exe`, the launcher, `chrome.exe` and the installer whenever the
`ENKI_SIGN_COMMAND` environment variable (in CI, the secret of the same name) holds a signing
command with `{file}` where the path goes. Code-signing keys are now issued only in hardware or
cloud HSMs, so this is a command rather than a certificate file. Two routes fit this project:

- **[SignPath Foundation](https://signpath.org)** — free code signing for open-source projects,
  with a GitHub Actions integration. Needs the project to apply.
- **Azure Trusted Signing** — paid, with identity verification of the publisher.

Until one is in place, releases are unsigned.


## Enki Shield: phishing protection that stays on your device

Enki Browser has no Google Safe Browsing — ungoogled-chromium removes it, since it reports
hashes of the pages you open to Google. **Enki Shield** takes its place for phishing:

- Twice a day it downloads [phishing-filter](https://gitlab.com/malware-filter/phishing-filter)
  (built from OpenPhish, PhishTank and IPThreat, with the world's most popular sites excluded to
  avoid false alarms): about 40,000 domains and 28,000 individual pages.
- **Every check happens in the browser.** The sites you visit are never sent anywhere — the only
  thing Enki Shield ever fetches is the list itself.
- A listed domain is refused before any connection is made; a listed page on a shared host
  (Weebly, Google Sites…) is stopped as the navigation starts. Either way you see a warning with
  *Back to safety* and *I understand the risk, open it anyway* (that one site, this session only).
- Try it safely: open `https://test.enki-shield.invalid` — always blocked, never real.

Malware sites are covered separately by uBlock Origin Lite's *Badware risks* and URLhaus lists.

## What it looks like

- **Enki Home** is the new tab: one box that asks Enki — the side panel opens with your request
  already sent, in *Ask* or *Act* mode — or, with Alt+Enter or the globe, searches DuckDuckGo.
  Typing an address just opens it. It speaks Portuguese, Spanish or English, following the browser.
- **A sober look:** neutral grey window chrome, light or dark following the operating system;
  Enki Home and the panel use the same quiet palette, and the panel lets you pick your own colours.
  Profiles from 0.3–0.5, which kept the old navy theme, are moved to it once (a backup of
  `Preferences` is kept next to it).
- **Its own name and icon:** the window title, About, menus and update messages say Enki Browser
  in every language, and the taskbar, Alt+Tab and the Linux dock show Enki's icon. The About page
  shows Enki's logo and Enki Browser's version in front of Chromium's, and keeps crediting the
  Chromium project and its authors.

## What is inside

| | Default | Where it comes from |
|---|---|---|
| AI assistant | Enki in the side panel, pinned to the toolbar | [danilogiles/enkibrowser](https://github.com/danilogiles/enkibrowser), MIT |
| AI model | NVIDIA Nemotron 3 Ultra by default — free key from [build.nvidia.com](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b), no credit card; or Claude, GPT, Gemini, Groq, OpenRouter, Ollama, OmniRoute | chosen in Enki's Settings |
| Ads and trackers | Blocked (EasyList, EasyPrivacy, Peter Lowe's list, uBlock filters) | [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home), unmodified |
| Malware sites | Blocked by uBlock's *Badware risks* and the URLhaus *Malicious URL Blocklist* | uBlock Origin Lite |
| Search | DuckDuckGo | `config/initial_preferences.json` |
| Connections | `http://` upgraded to `https://`, with a warning where a site has no HTTPS | same |
| Third-party cookies | Blocked | same |
| Fingerprinting | Tiny per-page noise in canvas and layout readings | ungoogled-chromium switches in `config/flags.txt` |
| WebRTC | Public interface only (no local IP leak) | same |
| Google services, telemetry, crash reports | None — removed by ungoogled-chromium | [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) |

Every default applies to a **new profile** and can be changed in the browser's settings.

## How it is built

Nothing here compiles Chromium (yet — see the roadmap). `build/build.mjs`:

1. downloads ungoogled-chromium's official Windows build and uBlock Origin Lite at the versions
   pinned in [`upstream.json`](upstream.json), and **refuses any file whose SHA-256 differs** from
   the pinned digest;
2. builds Enki from its repository and gives it a fixed extension id (`config/enki-extension.pub`),
   so its settings survive reinstalls and it can be pinned;
3. adds Enki Shield and the theme, renames the UI, and writes the first-run defaults next to
   `chrome.exe`;
4. compiles, with the C# compiler Windows ships, `EnkiBrowser.exe` (the stub), each release's
   `EnkiBrowserLauncher.exe` (starts Chromium with its profile, the built-in extensions and the
   privacy switches, and runs the updater) and `EnkiBrowserSetup.exe` (the zip embedded in an
   installer). No PowerShell is involved in installing, updating or uninstalling.

Why a launcher: a prebuilt Chromium can only force-install extensions that are not on the Chrome
Web Store on domain-managed Windows machines, and its policy registry key is shared with every
other Chromium on the computer. Command-line switches keep Enki Browser self-contained.

```bash
npm ci
npm run build         # → out/EnkiBrowser/, the zip and EnkiBrowserSetup-<version>.exe
npm run verify        # starts the built browser and checks every default by using it
node test/setup.mjs   # installer: fresh install, upgrade from 0.1–0.4, uninstall
node test/update.mjs  # builds two versions and checks the updater: forged, tampered, downgrade, real
```

Requirements: Windows 10/11 x64, Node.js 22+, Git. The C# compiler that ships with Windows' .NET
Framework builds the launcher; nothing else to install.

To build against a local Enki checkout: `ENKI_DIST=../enkibrowser/dist npm run build`.

## Verified

`npm run verify` starts the built browser through its launcher with a throwaway profile and
checks what a user would observe, not what the config says:

- Chromium 153 starts; Enki runs with its fixed id; the blocker runs
- DuckDuckGo is the default search engine in `chrome://settings/search`
- `http://example.com` ends up on `https://`
- ad and tracker scripts never load: refused, or replaced by uBlock's harmless stub
- the same canvas drawing reads back differently on each load
- `chrome://settings/cookies` has third-party cookies blocked
- the browser does not keep running after its last window closes (so updates can install)
- a new tab opens Enki Home; the About page and the window title say Enki Browser; About shows
  Enki Browser's version, Enki's logo (not Chromium's) and the Chromium credits; no custom theme
  is active; `chrome.exe` describes itself as Enki Browser
- Enki Shield has the phishing list; its test address, a real listed domain and a listed page
  all show the warning; another page on the same host does not; *open it anyway* lets the site
  through
- the Enki panel renders

With `ENKI_LIVE_MODEL=cfp/moonshotai/kimi-k2.6` and a local OmniRoute, it also has Enki complete
a real task inside Enki Browser (navigate to Wikipedia, read the page, answer).

## Known gaps

Honest list; each is on the roadmap.

- **Phishing protection is list-based.** Enki Shield blocks what public lists know about, updated
  twice a day; Google's Safe Browsing also uses signals no public list has, so a brand-new phishing
  site can reach you before it is listed. Be careful with links from email and messages.
- **Updates need a restart**, like every browser: a downloaded fix is offered in a notification
  and waits for your click (or your next start). Incognito windows do not come back after it.
- **Not code-signed yet**, so SmartScreen warns on install and a behaviour-based antivirus may
  distrust the updater (see [Code signing](#code-signing)).
- **A few Chromium traces remain:** the process is still called `chrome.exe`, and the version line
  on the About page still names ungoogled-chromium after Enki Browser's version. Changing those needs Enki Browser's own Chromium build.
- **"Enki started debugging this browser" bar** while Enki acts on a page. That is Chromium's
  warning for the debugger API extensions use; a built-in assistant will not need it.
- **No Chrome Web Store.** As in ungoogled-chromium, extensions install from `.crx` files with a
  confirmation prompt. See [chromium-web-store](https://github.com/NeverDecaf/chromium-web-store).
- **No automatic updates on Linux yet**: install each new release with the `.deb`, `install.sh` or
  the one-line installer. No macOS build (it needs an Apple Developer account to notarise).
- **x86_64 only.**

## Roadmap

1. **Now — distribution (this repo, 0.x):** pinned upstream, built-in Enki and blocker, verified
   defaults, installer, CI builds and releases.
2. **Updates:** ✅ signed self-updates (0.2.0). Next: a public security cadence — a release within
   days of every Chromium security fix. ✅ Checks while open and a one-click restart (0.7.1).
3. **Own Chromium build:** ungoogled-chromium's patch set plus ours — the Enki Browser name and icon
   everywhere, Enki as a component extension without the debugger bar, a Safe Browsing
   replacement, and privacy defaults compiled in.
4. **An assistant built to resist prompt injection:** the model that reads pages gets no tools, the
   agent needs per-site permission on sites you are logged in to, and every release must pass a
   public corpus of injection attacks.
5. **macOS**, Linux auto-updates and ARM builds, with the community.

## Contributing

Most work on the assistant happens in [enkibrowser](https://github.com/danilogiles/enkibrowser)
and needs only Node.js — see its [CONTRIBUTING.md](https://github.com/danilogiles/enkibrowser/blob/main/CONTRIBUTING.md).
This repository is the browser around it: build, launcher, defaults, installer. Issues and pull
requests are welcome; sign off your commits (`git commit -s`).

Security issues: report them [privately](https://github.com/danilogiles/enki-browser/security/advisories/new),
never in a public issue.

## License

Enki Browser's own code is MIT (see [LICENSE](LICENSE)). The bundled components keep their
licenses — see [THIRD_PARTY.md](THIRD_PARTY.md).

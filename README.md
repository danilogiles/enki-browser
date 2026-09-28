# Enki Browser

**A private, open-source Chromium browser with an AI assistant built in. Bring your own model.**

Enki Browser is [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
— Chromium without Google's services or telemetry — with the [Enki](https://github.com/danilogiles/enkibrowser)
assistant in the side panel, a tracker blocker on by default, and privacy defaults in the spirit
of Brave and DuckDuckGo. The assistant reads the page you are on and, when you let it, navigates,
clicks and types for you — with the model *you* choose: Claude, GPT, Gemini, a local Ollama model,
or free models through OmniRoute.

> **Status: 0.1, early alpha, Windows x64.** It works and is verified end to end (below), but it
> is young: read [Known gaps](#known-gaps) before making it your main browser.

## Install

1. Download `EnkiBrowser-<version>-windows-x64.zip` from [Releases](https://github.com/danilogiles/enki-browser/releases) and check it against the `.sha256` file next to it.
2. Extract it anywhere and double-click **`Install Enki Browser.cmd`**. No administrator rights
   are needed: it installs for your user into `%LOCALAPPDATA%\Programs\EnkiBrowser`, adds Start
   menu and desktop shortcuts, and appears in *Settings → Apps* for uninstalling.
3. Open Enki Browser, click the Enki icon in the toolbar (or press `Ctrl+Shift+E`), and choose
   a model in the panel's Settings.

**Portable use:** instead of installing, create an empty file named `portable` next to
`EnkiBrowser.exe` and run it from there; the profile then lives in that folder.

Windows SmartScreen may warn that the app is unrecognised, because releases are not yet
code-signed. Check the SHA-256, then choose *More info → Run anyway*.

## Updates

From 0.2.0, Enki Browser updates itself. Once a day, after the browser has opened, the launcher
looks for a newer release, downloads it in the background and installs it **the next time you
start Enki Browser** — never while it is open, because Chromium holds its files. Your profile,
history and Enki settings are untouched, and the previous version is kept in `.previous`.

An update is installed only if:

- its `update.json` carries a valid **RSA-3072 signature** from the release key. That key exists
  only as a secret in this repository's CI; the launcher trusts nothing else, so a tampered
  download or a compromised release page cannot push code to you;
- the zip's SHA-256 matches the one in that signed manifest;
- its version is **newer** than the one installed (no downgrades).

`.update\update.log` in the install folder records every check. To turn updates off, create an
empty file named `no-update` next to `EnkiBrowser.exe`. Coming from 0.1.0, install 0.2.0 once
by hand; from then on it updates itself.

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
- **Enki's colours** on the whole window: deep navy frame and toolbar, sky accents.
- **Its own name and icon:** the window title, About, menus and update messages say Enki Browser
  (in all 50 languages), and Windows shows Enki's icon in the taskbar and Alt+Tab.

## What is inside

| | Default | Where it comes from |
|---|---|---|
| AI assistant | Enki in the side panel, pinned to the toolbar | [danilogiles/enkibrowser](https://github.com/danilogiles/enkibrowser), MIT |
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
3. writes the first-run defaults next to `chrome.exe` and compiles `launcher/EnkiBrowser.cs` — the
   `EnkiBrowser.exe` that starts Chromium with its own profile, the built-in extensions and the
   privacy switches.

Why a launcher: a prebuilt Chromium can only force-install extensions that are not on the Chrome
Web Store on domain-managed Windows machines, and its policy registry key is shared with every
other Chromium on the computer. Command-line switches keep Enki Browser self-contained.

```bash
npm ci
npm run build     # → out/EnkiBrowser/ and out/EnkiBrowser-<version>-windows-x64.zip
npm run verify    # starts the built browser and checks every default by using it
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
- a new tab opens Enki Home; the About page and the window title say Enki Browser; the theme is
  active; `chrome.exe` describes itself as Enki Browser
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
- **Updates apply on restart.** If Enki Browser stays open for days, a downloaded security fix
  waits until you close and reopen it.
- **A few Chromium traces remain:** the process is still called `chrome.exe`, and the version line
  on the About page names ungoogled-chromium. Changing those needs Enki Browser's own Chromium build.
- **"Enki started debugging this browser" bar** while Enki acts on a page. That is Chromium's
  warning for the debugger API extensions use; a built-in assistant will not need it.
- **No Chrome Web Store.** As in ungoogled-chromium, extensions install from `.crx` files with a
  confirmation prompt. See [chromium-web-store](https://github.com/NeverDecaf/chromium-web-store).
- **Windows only**, x64.

## Roadmap

1. **Now — distribution (this repo, 0.x):** pinned upstream, built-in Enki and blocker, verified
   defaults, installer, CI builds and releases.
2. **Updates:** ✅ signed self-updates (0.2.0). Next: a public security cadence — a release within
   days of every Chromium security fix — and an update prompt for browsers that stay open.
3. **Own Chromium build:** ungoogled-chromium's patch set plus ours — the Enki Browser name and icon
   everywhere, Enki as a component extension without the debugger bar, a Safe Browsing
   replacement, and privacy defaults compiled in.
4. **An assistant built to resist prompt injection:** the model that reads pages gets no tools, the
   agent needs per-site permission on sites you are logged in to, and every release must pass a
   public corpus of injection attacks.
5. **macOS and Linux**, with the community.

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

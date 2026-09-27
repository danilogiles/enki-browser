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
- the Enki panel renders

With `ENKI_LIVE_MODEL=cfp/moonshotai/kimi-k2.6` and a local OmniRoute, it also has Enki complete
a real task inside Enki Browser (navigate to Wikipedia, read the page, answer).

## Known gaps

Honest list; each is on the roadmap.

- **No Google Safe Browsing.** ungoogled-chromium removes it. uBlock's malware lists cover known
  malware and badware hosts, but phishing protection is weaker than Chrome's or Brave's. Be
  careful with links from email and messages.
- **No automatic updates.** Chromium ships security fixes every few weeks; until the updater
  exists, install new releases as they come out. Watch this repository to be notified.
- **Chromium branding in places** (the About page, the process name `chrome.exe`). A real rebrand
  needs Enki Browser's own Chromium build.
- **"Enki started debugging this browser" bar** while Enki acts on a page. That is Chromium's
  warning for the debugger API extensions use; a built-in assistant will not need it.
- **No Chrome Web Store.** As in ungoogled-chromium, extensions install from `.crx` files with a
  confirmation prompt. See [chromium-web-store](https://github.com/NeverDecaf/chromium-web-store).
- **Windows only**, x64.

## Roadmap

1. **Now — distribution (this repo, 0.x):** pinned upstream, built-in Enki and blocker, verified
   defaults, installer, CI builds and releases.
2. **Updates:** a signed update feed and updater, and a public security cadence — a release within
   days of every Chromium security fix.
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

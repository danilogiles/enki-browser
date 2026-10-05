# Contributing to Enki Browser

Thanks for helping. Enki Browser is a private, open-source Chromium browser with the Enki AI
assistant built in, made in the open so anyone can check what it does and what it sends.

*Português e español são bem-vindos em issues e discussões — escreva na língua em que você se
expressa melhor.*

Questions, ideas and show-and-tell go in [Discussions](https://github.com/danilogiles/enki-browser/discussions).
Bugs and concrete proposals go in [Issues](https://github.com/danilogiles/enki-browser/issues).

## Two repositories

| | Repository | What lives there |
|---|---|---|
| The assistant | [danilogiles/enkibrowser](https://github.com/danilogiles/enkibrowser) | Enki itself: the side panel, Enki Home, the agent, web search, connections (MCP), charts. It is a Chromium extension and works in any Chromium browser. |
| The browser | this repository | Packaging ungoogled-chromium with Enki, Enki Shield (Shields button, burn, phishing warnings) and uBlock Origin Lite; the launcher, the signed updater, the installer, Linux packages, privacy defaults. |

Most AI work happens in **enkibrowser**; you do not need to build this browser to work on Enki.

## Where you can help here

| Area | Where it lives | Good for |
|---|---|---|
| Shields | `shield/` (plain JS, no build step) | Privacy features: tracking-parameter stripping, Global Privacy Control, a better blocked-items view |
| Launcher, updater, installer | `launcher/`, `installer/` (C#, .NET Framework, C# 5) | Windows integration, update UX |
| Linux packaging | `packaging/linux/` | Other distributions, Flatpak, auto-updates |
| Build and branding | `build/`, `config/` | macOS, ARM, translations of the rebrand |
| Privacy defaults | `config/initial_preferences.json`, `config/flags.txt` | New defaults, with the reasoning |
| Docs and translations | `README.md`, `PRIVACY.md`, `TERMS.md` | Portuguese, Spanish and more |

Issues labelled **good first issue** are small and well described. Comment on one before you
start so two people don't do the same work.

## Getting started

Windows 10/11 (the build compiles with the C# compiler Windows ships) or Linux, and Node.js 22:

```bash
git clone https://github.com/danilogiles/enki-browser.git
cd enki-browser
npm ci
node build/build.mjs          # Windows: out/EnkiBrowser/, the portable zip and the installer
node build/build-linux.mjs    # Linux: the .deb and the tarball
```

The first build downloads ungoogled-chromium and uBlock Origin Lite at the pinned versions in
`upstream.json` and checks their SHA-256. To build with a local Enki instead of its `main`,
point `ENKI_DIST` at its `dist/` folder.

Changing only `shield/`? Load `out/EnkiBrowser/app/<version>/extensions/shield` in any Chromium
browser as an unpacked extension to iterate, then rebuild.

## Tests

```bash
node test/verify.mjs    # starts the built browser and checks the product: blocking, Shields, burn, HTTPS, About, Enki Home…
node test/update.mjs    # the signed updater end to end: forged, tampered and old releases refused, live update, restart
node test/setup.mjs     # the installer (Windows)
```

CI runs them on Windows and Linux for every pull request, and they must pass before a merge.

## What a pull request needs

- **Every check green.** CI will tell you; running `verify.mjs` locally is faster.
- **You ran it.** Say what you did in the browser and what happened. "Should work" is not a
  result. Add a screenshot for anything visible.
- **One concern per PR**, and a commit message that says what changed and why, in prose.
- **A sign-off on every commit** (`git commit -s`): the
  [Developer Certificate of Origin](https://developercertificate.org). No CLA.

## Rules that are not negotiable

These protect people who trust the browser with everything they do online.

1. **No telemetry and no new destination for user data.** A change that makes the browser
   contact something new says what, when and why, and updates the table in `PRIVACY.md`.
2. **Updates stay signed.** Never weaken the signature, hash or downgrade checks in
   `launcher/Updater.cs`.
3. **Pinned inputs stay pinned.** A new download goes into `upstream.json` with its SHA-256.
4. **Third-party code keeps its license** and is listed in `THIRD_PARTY.md`; a patch to it is a
   published file in `patches/`.
5. **Enki's safety rules hold** (no typing passwords, confirmation before sensitive actions, page
   text is data): see the assistant's repository.

## Security

Never in a public issue: report privately through
[GitHub's vulnerability reporting](https://github.com/danilogiles/enki-browser/security/advisories/new).
See [SECURITY.md](SECURITY.md).

By contributing you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

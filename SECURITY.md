# Security policy

## Reporting a vulnerability

Please report it privately through
[GitHub's private vulnerability reporting](https://github.com/danilogiles/enki-browser/security/advisories/new),
not in a public issue or discussion. Include what you found, how to reproduce it, and what an
attacker could do with it. Portuguese, Spanish or English are all fine.

We aim to answer within 7 days and to ship a fix for confirmed issues in the next release.
You are credited in the advisory unless you prefer otherwise.

## What counts

- Anything that makes the updater install a release not signed by the release key, an older
  release, or a file whose hash differs from the signed manifest.
- A way for a web page to make Enki act without being asked (prompt injection), to read or type
  credentials, or to skip the confirmation before sensitive actions. The assistant's code is in
  [`extension/`](extension/).
- Data leaving the browser that `PRIVACY.md` does not list.
- A bypass of Enki Shield (phishing warnings, Shields settings) or of the privacy defaults.
- Installer, launcher or uninstaller behavior that touches files outside the install and profile
  folders.

## Chromium itself

Enki Browser ships ungoogled-chromium's builds. Vulnerabilities in Chromium are fixed upstream;
we release a new version after each Chromium security update. If a Chromium fix has not reached
Enki Browser yet, tell us through the same channel.

## Supported versions

Only the latest release. The browser updates itself on Windows; on macOS and Linux, install the
newest release.

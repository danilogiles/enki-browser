# Third-party software in Enki Browser

Enki Browser's own code — the build script, the launcher, the installer and the defaults in
`config/` — is MIT licensed (see `LICENSE`). The browser bundles the following, each under its
own license. Exact versions and download hashes are pinned in `upstream.json`.

| Component | What it is | License | Source |
|---|---|---|---|
| ungoogled-chromium | The browser: Chromium with Google services and telemetry removed. The project's official Windows build with two changes made by `build/build.mjs`: the product name in the locale `.pak` files reads "Enki Browser" instead of "Chromium", and `chrome.exe` and `chrome.dll` carry Enki's icon (and `chrome.exe` its name in its version resources). No code is changed. | BSD-3-Clause; Chromium itself is BSD-3-Clause plus the third-party licenses listed at `chrome://credits` | [Windows](https://github.com/ungoogled-software/ungoogled-chromium-windows), [Linux](https://github.com/ungoogled-software/ungoogled-chromium-portablelinux) |
| uBlock Origin Lite | Ad and tracker blocker, shipped as a separate extension with one small addition (below). | GPL-3.0 | https://github.com/uBlockOrigin/uBOL-home |
| Enki Shield | Phishing warnings (`shield/`), written for Enki Browser. | MIT | this repository |
| Enki | The AI assistant in the side panel, and Enki Home. The build adds a fixed `key` to its manifest so its extension id is stable, and makes Enki Home the new tab page. | MIT | https://github.com/danilogiles/enkibrowser |

Data downloaded at run time, not shipped: Enki Shield fetches
[phishing-filter](https://gitlab.com/malware-filter/phishing-filter) (filters CC BY-SA 4.0; sources
OpenPhish, PhishTank and IPThreat) from malware-filter.gitlab.io, falling back to
malware-filter.pages.dev. The warning page credits it.

Build tools that are not shipped: [rcedit](https://github.com/electron/rcedit) (MIT) sets the icon and version strings of `chrome.exe`.

uBlock Origin Lite is aggregated alongside the browser, not combined with it: it runs as its own
extension, and its complete source is at the link above for the pinned version. The GPL applies
to it alone. Enki Browser makes two changes, both in this repository: the build gives it a fixed
extension id (a public key in its manifest, `config/ublock-extension.pub`) so its settings
survive updates, and appends [`patches/ublock-lite-shields.js`](patches/ublock-lite-shields.js)
(GPL-3.0) to its background script, which lets Enki Shield read and set a site's filtering mode
for the Shields button. The patch reaches only uBlock's existing filtering-mode requests.

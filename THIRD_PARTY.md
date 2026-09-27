# Third-party software in Enki Browser

Enki Browser's own code — the build script, the launcher, the installer and the defaults in
`config/` — is MIT licensed (see `LICENSE`). The browser bundles the following, each under its
own license. Exact versions and download hashes are pinned in `upstream.json`.

| Component | What it is | License | Source |
|---|---|---|---|
| ungoogled-chromium | The browser: Chromium with Google services and telemetry removed. The project's official Windows build with two changes made by `build/build.mjs`: the product name in the locale `.pak` files reads "Enki Browser" instead of "Chromium", and `chrome.exe` carries Enki's icon and name in its version resources. No code is changed. | BSD-3-Clause; Chromium itself is BSD-3-Clause plus the third-party licenses listed at `chrome://credits` | https://github.com/ungoogled-software/ungoogled-chromium-windows |
| uBlock Origin Lite | Ad and tracker blocker. Shipped **unmodified** as a separate extension. | GPL-3.0 | https://github.com/uBlockOrigin/uBOL-home |
| Enki | The AI assistant in the side panel, and Enki Home. The build adds a fixed `key` to its manifest so its extension id is stable, and makes Enki Home the new tab page. | MIT | https://github.com/danilogiles/enkibrowser |

Build tools that are not shipped: [rcedit](https://github.com/electron/rcedit) (MIT) sets the icon and version strings of `chrome.exe`.

uBlock Origin Lite is aggregated alongside the browser, not combined with it: it runs as its own
extension, and its complete source is at the link above for the pinned version. The GPL applies
to it alone.

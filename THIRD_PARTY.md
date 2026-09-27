# Third-party software in Enki Browser

Enki Browser's own code — the build script, the launcher, the installer and the defaults in
`config/` — is MIT licensed (see `LICENSE`). The browser bundles the following, each under its
own license. Exact versions and download hashes are pinned in `upstream.json`.

| Component | What it is | License | Source |
|---|---|---|---|
| ungoogled-chromium | The browser: Chromium with Google services and telemetry removed. Shipped as the project's official Windows build, unmodified. | BSD-3-Clause; Chromium itself is BSD-3-Clause plus the third-party licenses listed at `chrome://credits` | https://github.com/ungoogled-software/ungoogled-chromium-windows |
| uBlock Origin Lite | Ad and tracker blocker. Shipped **unmodified** as a separate extension. | GPL-3.0 | https://github.com/uBlockOrigin/uBOL-home |
| Enki | The AI assistant in the side panel. The build adds a fixed `key` to its manifest so its extension id is stable. | MIT | https://github.com/danilogiles/enkibrowser |

uBlock Origin Lite is aggregated alongside the browser, not combined with it: it runs as its own
extension, and its complete source is at the link above for the pinned version. The GPL applies
to it alone.

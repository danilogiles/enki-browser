// Writes enki-browser.json, a Scoop manifest, next to a Windows release zip:
//
//   node build/scoop-manifest.mjs dist/EnkiBrowser-X-windows-x64.zip <download url>
//
// Published with each release, so anyone can install without running an installer:
//   scoop install https://github.com/danilogiles/enki-browser/releases/latest/download/enki-browser.json
// Scoop then owns updates for that copy (`scoop update enki-browser`), so the manifest turns the
// built-in updater off there; two updaters fighting over one folder helps nobody.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [zip, url] = process.argv.slice(2);
if (!zip || !url) throw new Error("usage: scoop-manifest.mjs <zip> <download url>");
const version = /EnkiBrowser-(\d+\.\d+\.\d+)-windows-x64\.zip$/.exec(path.basename(zip))?.[1];
if (!version) throw new Error(`Cannot read a version from ${path.basename(zip)}`);
const hash = createHash("sha256").update(readFileSync(zip)).digest("hex");

const manifest = {
  version,
  description: "Private, open-source Chromium browser with the Enki AI assistant built in.",
  homepage: "https://github.com/danilogiles/enki-browser",
  license: "MIT",
  notes: "Enki Browser is updated by Scoop: scoop update enki-browser",
  architecture: { "64bit": { url, hash } },
  extract_dir: "EnkiBrowser",
  pre_install: "New-Item -ItemType File -Force -Path \"$dir\\no-update\" | Out-Null",
  shortcuts: [["EnkiBrowser.exe", "Enki Browser"]],
  checkver: { github: "https://github.com/danilogiles/enki-browser" },
  autoupdate: {
    architecture: {
      "64bit": { url: "https://github.com/danilogiles/enki-browser/releases/download/v$version/EnkiBrowser-$version-windows-x64.zip" },
    },
  },
};
writeFileSync(path.join(path.dirname(zip), "enki-browser.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote enki-browser.json for ${version} (${hash})`);

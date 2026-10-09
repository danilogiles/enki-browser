// Fails when an extension we ship changed since the last release but its version did not.
//
// Chromium keeps an extension's background service worker registered for the version it saw
// first: with the same version, an updated Enki Browser kept pointing at the previous build's
// worker, which no longer exists, and the background never ran (0.8.4: Enki 0.3.0 and Shield
// 1.2.0 unchanged, so Ctrl+Shift+E did nothing after an update). The build stamps every release
// into Enki's and Shield's versions (releaseStamp in build/common.mjs); this keeps the versions
// people see honest as well, and covers uBlock, whose version only changes with uBlock.
//
//   node test/extension-versions.mjs [previous-tag]    default: the newest v* tag not at HEAD
// Needs the tag: `git fetch --depth=1 origin 'refs/tags/v*:refs/tags/v*'` in a shallow clone.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const head = git("rev-parse", "HEAD");
const semver = (t) => t.replace(/^v/, "").split(".").map(Number);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
const tags = git("tag", "--list", "v*.*.*").split("\n").filter((t) => /^v\d+\.\d+\.\d+$/.test(t)).sort(newer).reverse();
const previous = process.argv[2] ?? tags.find((t) => git("rev-list", "-n", "1", t) !== head);
if (!previous) {
  console.log("no earlier release tag to compare with; nothing to check");
  process.exit(0);
}

const show = (ref, file) => git("show", `${ref}:${file}`);
const json = (ref, file) => JSON.parse(show(ref, file));
const changed = (pathspecs) => git("diff", "--name-only", previous, "HEAD", "--", ...pathspecs).split("\n").filter(Boolean);
// What ends up in the extension folder: not tests, docs or dev tooling.
const shipped = {
  Enki: {
    paths: ["extension", ":(exclude)extension/test", ":(exclude)extension/docs", ":(exclude)extension/docker", ":(exclude)extension/docker-compose.yml", ":(exclude,glob)extension/**/*.md"],
    version: (ref) => json(ref, "extension/package.json").version,
    bump: "extension/package.json and extension/package-lock.json",
  },
  "Enki Shield": {
    paths: ["shield", ":(exclude,glob)shield/**/*.md"],
    version: (ref) => json(ref, "shield/manifest.json").version,
    bump: "shield/manifest.json",
  },
  "uBlock Origin Lite (with Enki's patch)": {
    paths: ["patches/ublock-lite-shields.js", "config/ublock-extension.pub"],
    version: (ref) => json(ref, "upstream.json").blocker.version,
    bump: "nothing of ours: its version is uBlock's, so ship a patch change together with a uBlock update",
  },
};

let failed = 0;
for (const [name, ext] of Object.entries(shipped)) {
  const files = changed(ext.paths);
  const before = ext.version(previous);
  const now = ext.version("HEAD");
  if (files.length && before === now) {
    failed++;
    console.log(`FAIL ${name} changed since ${previous} but is still ${now}: bump ${ext.bump}.\n     changed: ${files.join(", ")}`);
  } else {
    console.log(`PASS ${name}: ${before} → ${now}${files.length ? ` (${files.length} files changed)` : " (unchanged)"}`);
  }
}
process.exit(failed ? 1 : 0);

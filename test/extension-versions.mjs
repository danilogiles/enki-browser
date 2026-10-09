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
import { changedSince, previousTag, shipped } from "./shipped.mjs";

const previous = process.argv[2] ?? previousTag();
if (!previous) {
  console.log("no earlier release tag to compare with; nothing to check");
  process.exit(0);
}

let failed = 0;
for (const [key, ext] of Object.entries(shipped)) {
  const { name } = ext;
  const files = changedSince(previous, key);
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

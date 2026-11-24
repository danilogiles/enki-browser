// Checks that the macOS Info.plist scrub drops image and SVG document types and keeps web
// documents and http(s). Runs on any OS (no plutil): the filter is the same function
// build-mac.mjs uses. A fixture matching Chromium 156's app-Info.plist document types is
// also round-tripped through Python's plistlib.
//
//   node test/mac-document-types.mjs
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimedImageDocumentTypes,
  hasWebDocumentClaims,
  scrubMacInfoPlist,
} from "../build/scrub-mac-document-types.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++; else failed++;
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : ""));
};

// Chromium 156 chrome/app/app-Info.plist CFBundleDocumentTypes and CFBundleURLTypes (the
// handler claims). UTImportedTypeDeclarations are omitted: they catalog types, they do not
// register Enki as a viewer, and the scrub leaves them in place.
const chromium156 = {
  CFBundleDocumentTypes: [
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["com.compuserve.gif"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.html"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.xhtml"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["com.netscape.javascript-source"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.jpeg"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.ietf.mhtml"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.xiph.ogg-audio"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.xiph.ogv"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.png"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.svg-image"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.text"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.webmproject.webm"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.webmproject.webp"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.chromium.extension"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["com.adobe.pdf"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["org.chromium.shortcut"] },
    { CFBundleTypeRole: "Viewer", LSItemContentTypes: ["public.avif"] },
  ],
  CFBundleURLTypes: [
    { CFBundleURLName: "Web site URL", CFBundleURLSchemes: ["http", "https"] },
    { CFBundleURLName: "Local file URL", CFBundleURLSchemes: ["file"] },
  ],
};

const before = structuredClone(chromium156);
check("the Chromium 156 fixture claims SVG and other image types before the scrub",
  claimedImageDocumentTypes(before).join(" ") ===
    "com.compuserve.gif public.jpeg public.png public.svg-image org.webmproject.webp public.avif");

const { removed, kept, droppedTypes } = scrubMacInfoPlist(before);
check("the scrub removes the six image document types and keeps the rest",
  removed === 6 && kept === 11 && droppedTypes.includes("public.svg-image"),
  `${removed} removed, ${kept} kept, dropped ${droppedTypes.join(", ")}`);
check("after the scrub, no image document types remain", claimedImageDocumentTypes(before).length === 0,
  claimedImageDocumentTypes(before).join(", "));
check("HTML, XHTML, PDF and http(s) are still claimed", hasWebDocumentClaims(before));
const keptTypes = before.CFBundleDocumentTypes.flatMap((e) => e.LSItemContentTypes);
check("non-image document types Chromium already claimed stay (MHTML, text, JS, media, crx)",
  ["org.ietf.mhtml", "public.text", "com.netscape.javascript-source", "org.webmproject.webm", "org.chromium.extension"].every((t) => keptTypes.includes(t)),
  keptTypes.join(", "));
check("CFBundleURLTypes are untouched",
  JSON.stringify(before.CFBundleURLTypes) === JSON.stringify(chromium156.CFBundleURLTypes));
check("a second scrub is a no-op", scrubMacInfoPlist(before).removed === 0 && before.CFBundleDocumentTypes.length === 11);

// Older plists (and some third-party copies) still use extensions and MIME types instead of UTIs.
const legacy = {
  CFBundleDocumentTypes: [
    { CFBundleTypeName: "HTML", CFBundleTypeExtensions: ["html", "htm", "shtml"], CFBundleTypeMIMETypes: ["text/html"] },
    { CFBundleTypeName: "SVG document", CFBundleTypeExtensions: ["svg", "svgz"], CFBundleTypeMIMETypes: ["image/svg+xml"] },
    { CFBundleTypeName: "PNG image", CFBundleTypeExtensions: ["png"], CFBundleTypeMIMETypes: ["image/png"] },
    { CFBundleTypeName: "PDF document", CFBundleTypeExtensions: ["pdf"], CFBundleTypeMIMETypes: ["application/pdf"] },
  ],
};
const legacyResult = scrubMacInfoPlist(legacy);
check("legacy extension/MIME entries for SVG and PNG are dropped, HTML and PDF stay",
  legacyResult.removed === 2 && legacy.CFBundleDocumentTypes.map((e) => e.CFBundleTypeName).join(",") === "HTML,PDF document");

// Round-trip the Chromium 156 fixture through Python's plistlib (XML), then scrub the result.
const py = spawnSync("python3", ["-c", `
import json, plistlib, sys
plist = json.load(sys.stdin)
xml = plistlib.dumps(plist, fmt=plistlib.FMT_XML)
again = plistlib.loads(xml)
# plutil-style: keep JSON comparable
json.dump(again, sys.stdout)
`], { input: JSON.stringify(chromium156), encoding: "utf8" });
if (py.status !== 0) {
  check("Python plistlib is available to round-trip the fixture", false, py.stderr || py.error?.message || "python3 failed");
} else {
  const fromPlistlib = JSON.parse(py.stdout);
  check("Python plistlib round-trips the Chromium 156 fixture",
    claimedImageDocumentTypes(fromPlistlib).includes("public.svg-image") && hasWebDocumentClaims(fromPlistlib));
  scrubMacInfoPlist(fromPlistlib);
  const xmlAfter = spawnSync("python3", ["-c", `
import json, plistlib, sys
plist = json.load(sys.stdin)
# Confirm the scrubbed dict is still a valid plist, then echo claimed types.
plistlib.dumps(plist, fmt=plistlib.FMT_XML)
types = [t for e in plist.get("CFBundleDocumentTypes", []) for t in (e.get("LSItemContentTypes") or [])]
print(" ".join(types))
`], { input: JSON.stringify(fromPlistlib), encoding: "utf8" });
  check("Python plistlib accepts the scrubbed plist and it has no image UTIs",
    xmlAfter.status === 0
      && !/\b(public\.svg-image|public\.png|public\.jpeg|public\.avif|org\.webmproject\.webp|com\.compuserve\.gif)\b/.test(xmlAfter.stdout)
      && /\bpublic\.html\b/.test(xmlAfter.stdout) && /\bcom\.adobe\.pdf\b/.test(xmlAfter.stdout),
    xmlAfter.stderr || xmlAfter.stdout.trim());
}

// Linux is already clean: the .desktop file claims only HTML and http(s), no image MIME types.
const desktop = readFileSync(path.join(root, "packaging", "linux", "enki-browser.desktop"), "utf8");
const mime = (desktop.match(/^MimeType=(.*)$/m) || [])[1] || "";
check("the Linux .desktop file claims only text/html, XHTML and http(s), no image types",
  mime === "text/html;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;"
    && !/image\/|svg/i.test(mime),
  mime);

console.log();
console.log(passed + "/" + (passed + failed) + " checks passed");
process.exit(failed === 0 ? 0 : 1);

// Assembles Enki Browser for macOS from pinned upstream artifacts. Runs on macOS: it needs hdiutil,
// ditto, plutil, iconutil, codesign and clang. The Windows and Linux counterparts are build.mjs and
// build-linux.mjs; what all three share is in common.mjs.
//
//   node build/build-mac.mjs [--arch=arm64|x64]   → out/mac-<arch>/Enki Browser.app and
//                                                   out/EnkiBrowser-<ver>-macos-<arch>.dmg
//
// The architecture defaults to this Mac's. One build per architecture, like ungoogled-chromium's
// own releases, rather than a universal app twice the size.
//
// The app is ungoogled-chromium's Chromium.app with its name, icon and bundle id changed, Enki
// Browser's files in Contents/Resources/enki/, and a small launcher as its main executable. The
// changes break upstream's signature, so the app is signed again, ad hoc: macOS on Apple silicon
// runs nothing unsigned. An ad hoc signature is not a Developer ID, so Gatekeeper still asks the
// user to confirm the first launch (README, "macOS"); notarization needs an Apple Developer account.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import sharp from "sharp";
import { addExtensions, fetchPinned, hash, out, pkg, rebrand, replaceLogos, root, run, step, upstream, versionInfo, writeDefaults } from "./common.mjs";

if (process.platform !== "darwin") throw new Error("build-mac.mjs builds the macOS edition and runs on macOS (CI, or a Mac).");

const argArch = process.argv.find((a) => a.startsWith("--arch="))?.slice("--arch=".length);
const arch = argArch ?? (process.arch === "arm64" ? "arm64" : "x64");
if (!["arm64", "x64"].includes(arch)) throw new Error(`--arch must be arm64 or x64, not ${arch}`);
const pin = arch === "arm64" ? upstream.chromiumMacArm64 : upstream.chromiumMacX64;

// A reverse-DNS id of its own, so macOS does not take Enki Browser for a Chromium the user also
// has (the default-browser list, "Open with", the Dock would mix the two up).
const BUNDLE_ID = "io.github.danilogiles.EnkiBrowser";
const NAME = "Enki Browser";

const macOut = path.join(out, `mac-${arch}`);
const app = path.join(macOut, `${NAME}.app`);
const contents = path.join(app, "Contents");
const enkiRes = path.join(contents, "Resources", "enki");
const pkgDir = path.join(root, "packaging", "mac");

const plist = (file, ...args) => run("plutil", [...args, file]);
const plistHas = (file, key) => {
  try { execFileSync("plutil", ["-extract", key, "raw", file], { stdio: "ignore" }); return true; } catch { return false; }
};

step(`Cleaning out/mac-${arch}`);
rmSync(macOut, { recursive: true, force: true });
mkdirSync(macOut, { recursive: true });

step(`Fetching ${pin.name} ${pin.version}`);
const dmg = await fetchPinned(pin);
const mount = path.join(macOut, "_mount");
mkdirSync(mount);
run("hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mount, dmg]);
try {
  const upstreamApp = readdirSync(mount).find((f) => f.endsWith(".app"));
  if (!upstreamApp) throw new Error(`no .app in ${path.basename(dmg)}`);
  // ditto keeps what a plain copy can lose in a bundle: symlinks, permissions, extended attributes.
  run("ditto", [path.join(mount, upstreamApp), app]);
} finally {
  run("hdiutil", ["detach", mount, "-force"]);
  rmSync(mount, { recursive: true, force: true });
}

const frameworkDir = path.join(contents, "Frameworks", "Chromium Framework.framework");
const versionsDir = path.join(frameworkDir, "Versions");
const frameworkVersion = readdirSync(versionsDir).find((v) => v !== "Current");
const frameworkRes = path.join(versionsDir, frameworkVersion, "Resources");

const ext = await addExtensions(enkiRes);

step("Enki Browser's look and name");
const lprojs = readdirSync(frameworkRes).filter((d) => d.endsWith(".lproj"));
const localePaks = lprojs.map((d) => path.join(frameworkRes, d, "locale.pak")).filter(existsSync);
const english = ["en.lproj", "en_US.lproj", "en-US.lproj"].map((d) => path.join(frameworkRes, d, "locale.pak")).find(existsSync);
if (!english) throw new Error(`no English locale.pak among ${lprojs.join(", ")}`);
rebrand(null, { files: localePaks, english });
await replaceLogos(frameworkRes, pin.version, ext.iconDir);

// The app icon, drawn from Enki's vector logo at every size macOS asks for. Apple's app icons keep
// their artwork inside about 80% of the canvas; edge to edge, the shield looked bigger than every
// other icon in the Dock.
const infoPlist = path.join(contents, "Info.plist");
const iconFile = execFileSync("plutil", ["-extract", "CFBundleIconFile", "raw", infoPlist]).toString().trim();
const iconset = path.join(macOut, "enki.iconset");
mkdirSync(iconset);
const svg = path.join(root, "extension", "src", "assets", "logo.svg");
for (const [points, scale] of [[16, 1], [16, 2], [32, 1], [32, 2], [128, 1], [128, 2], [256, 1], [256, 2], [512, 1], [512, 2]]) {
  const px = points * scale;
  const inner = Math.round(px * 0.8);
  const pad = Math.floor((px - inner) / 2);
  await sharp(svg, { density: Math.max(72, Math.ceil((inner / 256) * 72)) })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: pad, left: pad, bottom: px - inner - pad, right: px - inner - pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(iconset, `icon_${points}x${points}${scale === 2 ? "@2x" : ""}.png`));
}
run("iconutil", ["-c", "icns", iconset, "-o", path.join(contents, "Resources", iconFile.endsWith(".icns") ? iconFile : `${iconFile}.icns`)]);
rmSync(iconset, { recursive: true, force: true });
// With CFBundleIconName set, macOS takes the icon from Assets.car (Chromium's) over the .icns.
if (plistHas(infoPlist, "CFBundleIconName")) plist(infoPlist, "-remove", "CFBundleIconName");

plist(infoPlist, "-replace", "CFBundleName", "-string", NAME);
plist(infoPlist, "-replace", "CFBundleDisplayName", "-string", NAME);
plist(infoPlist, "-replace", "CFBundleIdentifier", "-string", BUNDLE_ID);
plist(infoPlist, "-replace", "CFBundleExecutable", "-string", NAME);
plist(infoPlist, "-replace", "EnkiBrowserVersion", "-string", pkg.version);
// The menu bar and Finder read the localized name, per language, from InfoPlist.strings.
let localized = 0;
for (const d of readdirSync(path.join(contents, "Resources")).filter((d) => d.endsWith(".lproj"))) {
  const strings = path.join(contents, "Resources", d, "InfoPlist.strings");
  if (!existsSync(strings)) continue;
  plist(strings, "-convert", "binary1");
  for (const key of ["CFBundleDisplayName", "CFBundleName"]) {
    if (plistHas(strings, key)) { plist(strings, "-replace", key, "-string", NAME); localized++; }
  }
}
console.log(`  Info.plist: ${NAME}, ${BUNDLE_ID}; ${localized} localized names`);

step("Launcher and defaults");
run("clang", ["-O2", "-Wall", "-Werror", "-arch", arch === "arm64" ? "arm64" : "x86_64", "-mmacosx-version-min=12.0",
  "-o", path.join(contents, "MacOS", NAME), path.join(pkgDir, "launcher.c")]);
cpSync(path.join(pkgDir, "enki-browser.sh"), path.join(enkiRes, "enki-browser.sh"));
chmodSync(path.join(enkiRes, "enki-browser.sh"), 0o755);
writeDefaults(enkiRes, path.join(enkiRes, "config"), ext.enkiId, ext.shieldId);
cpSync(path.join(root, "LICENSE"), path.join(enkiRes, "LICENSE"));
cpSync(path.join(root, "THIRD_PARTY.md"), path.join(enkiRes, "THIRD_PARTY.md"));
const version = versionInfo({
  chromium: pin.version,
  arch,
  blocker: upstream.blocker.version,
  enki: ext.enkiVersion,
  enkiExtensionId: ext.enkiId,
  shieldExtensionId: ext.shieldId,
});
writeFileSync(path.join(enkiRes, "version.json"), JSON.stringify(version, null, 2));

step("Signing (ad hoc)");
// Inside out, each piece once: the framework (its resources changed), Chromium's executable, then
// the app, whose signature seals the rest. Chromium's own entitlements are kept; the helper apps
// inside the framework are unchanged and keep upstream's signatures.
run("codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", frameworkDir]);
run("codesign", ["--force", "--sign", "-", "--preserve-metadata=entitlements,flags", path.join(contents, "MacOS", "Chromium")]);
run("codesign", ["--force", "--sign", "-", app]);
run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);

step("Packaging the .dmg");
const stage = path.join(macOut, "_dmg");
mkdirSync(stage);
run("ditto", [app, path.join(stage, `${NAME}.app`)]);
symlinkSync("/Applications", path.join(stage, "Applications"));
const dmgName = `EnkiBrowser-${pkg.version}-macos-${arch}.dmg`;
const dmgPath = path.join(out, dmgName);
run("hdiutil", ["create", "-volname", NAME, "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", dmgPath]);
rmSync(stage, { recursive: true, force: true });
writeFileSync(`${dmgPath}.sha256`, `${hash(dmgPath)}  ${dmgName}\n`);

console.log(`\n✓ out/mac-${arch}/${NAME}.app, out/${dmgName}`);
console.log(JSON.stringify(version, null, 2));

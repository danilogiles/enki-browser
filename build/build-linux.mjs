// Assembles Enki Browser for Linux (x86_64) from pinned upstream artifacts. Runs on Linux: the
// archives must carry Unix permissions, which only a Linux build sets reliably. The Windows
// counterpart is build.mjs; what both share is in common.mjs.
//
//   node build/build-linux.mjs   → out/linux/enki-browser/, enki-browser-<ver>-linux-x64.tar.gz
//                                  and, where dpkg-deb exists, enki-browser_<ver>_amd64.deb
//
// Needs: node 22 and npm (or ENKI_DIST), unzip, tar with xz, sharp-free (icons come from Enki).
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { addExtensions, extract, fetchPinned, findRoot, hash, out, pkg, rebrand, replaceLogos, root, run, step, upstream, versionInfo, writeDefaults } from "./common.mjs";

if (process.platform !== "linux") throw new Error("build-linux.mjs builds the Linux edition and runs on Linux (CI, or Docker).");

const linuxOut = path.join(out, "linux");
const app = path.join(linuxOut, "enki-browser");
const pkgDir = path.join(root, "packaging", "linux");

step("Cleaning out/linux");
rmSync(linuxOut, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

step(`Fetching ${upstream.chromiumLinux.name} ${upstream.chromiumLinux.version}`);
const chromiumTar = await fetchPinned(upstream.chromiumLinux);
const tmp = path.join(linuxOut, "_chromium");
extract(chromiumTar, tmp);
cpSync(findRoot(tmp, "chrome"), path.join(app, "chromium"), { recursive: true });
rmSync(tmp, { recursive: true, force: true });
// The test driver and upstream's own wrapper are not part of Enki Browser.
for (const f of ["chromedriver", "chrome-wrapper"]) rmSync(path.join(app, "chromium", f), { force: true });

const ext = await addExtensions(app);

step("Enki Browser's look and name");
rebrand(path.join(app, "chromium"));
await replaceLogos(path.join(app, "chromium"), upstream.chromiumLinux.version, ext.iconDir);
// The window icon comes from the .desktop entry (matched by WM_CLASS), so Chromium's bundled
// product logos are replaced too for the places that use them directly.
mkdirSync(path.join(app, "icons"), { recursive: true });
for (const size of [16, 32, 48, 128, 256]) {
  const src = path.join(ext.iconDir, `icon${size}.png`);
  if (existsSync(src)) cpSync(src, path.join(app, "icons", `enki-browser-${size}.png`));
}
for (const size of [48]) {
  const logo = path.join(app, "chromium", `product_logo_${size}.png`);
  if (existsSync(logo)) cpSync(path.join(ext.iconDir, `icon${size}.png`), logo);
}

step("Defaults, launcher, installer");
writeDefaults(path.join(app, "chromium"), path.join(app, "config"), ext.enkiId, ext.shieldId);
for (const f of ["enki-browser", "install.sh", "uninstall.sh", "enki-browser.desktop", "apparmor-profile"]) cpSync(path.join(pkgDir, f), path.join(app, f));
for (const f of ["enki-browser", "install.sh", "uninstall.sh"]) chmodSync(path.join(app, f), 0o755);
cpSync(path.join(root, "LICENSE"), path.join(app, "LICENSE"));
cpSync(path.join(root, "THIRD_PARTY.md"), path.join(app, "THIRD_PARTY.md"));
const version = versionInfo({
  chromium: upstream.chromiumLinux.version,
  blocker: upstream.blocker.version,
  enki: ext.enkiVersion,
  enkiExtensionId: ext.enkiId,
  shieldExtensionId: ext.shieldId,
});
writeFileSync(path.join(app, "version.json"), JSON.stringify(version, null, 2));

step("Packaging the tar.gz");
const tarName = `enki-browser-${pkg.version}-linux-x64.tar.gz`;
const tarPath = path.join(out, tarName);
run("tar", ["-czf", tarPath, "-C", linuxOut, "--owner=0", "--group=0", "enki-browser"]);
writeFileSync(`${tarPath}.sha256`, `${hash(tarPath)}  ${tarName}\n`);

const hasDpkg = (() => { try { execFileSync("dpkg-deb", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();
if (hasDpkg) {
  step("Packaging the .deb");
  // System-wide under /opt, a command in /usr/bin, the menu entry and icons, and the AppArmor
  // profile Ubuntu 23.10+ needs for Chromium's sandbox.
  const deb = path.join(linuxOut, "deb");
  const opt = path.join(deb, "opt", "enki-browser");
  mkdirSync(path.dirname(opt), { recursive: true });
  cpSync(app, opt, { recursive: true });
  for (const f of ["install.sh", "uninstall.sh"]) rmSync(path.join(opt, f)); // apt installs and removes it
  mkdirSync(path.join(deb, "usr", "bin"), { recursive: true });
  symlinkSync("/opt/enki-browser/enki-browser", path.join(deb, "usr", "bin", "enki-browser"));
  mkdirSync(path.join(deb, "usr", "share", "applications"), { recursive: true });
  writeFileSync(path.join(deb, "usr", "share", "applications", "enki-browser.desktop"),
    readFileSync(path.join(pkgDir, "enki-browser.desktop"), "utf8").replaceAll("@EXEC@", "/usr/bin/enki-browser"));
  for (const size of [16, 32, 48, 128, 256]) {
    const dir = path.join(deb, "usr", "share", "icons", "hicolor", `${size}x${size}`, "apps");
    mkdirSync(dir, { recursive: true });
    cpSync(path.join(app, "icons", `enki-browser-${size}.png`), path.join(dir, "enki-browser.png"));
  }
  mkdirSync(path.join(deb, "etc", "apparmor.d"), { recursive: true });
  writeFileSync(path.join(deb, "etc", "apparmor.d", "enki-browser"),
    readFileSync(path.join(pkgDir, "apparmor-profile"), "utf8").replace("@CHROME@", "/opt/enki-browser/chromium/chrome"));

  const control = path.join(deb, "DEBIAN");
  mkdirSync(control, { recursive: true });
  const sizeKb = execFileSync("du", ["-sk", path.join(deb, "opt")]).toString().split(/\s+/)[0];
  // Chromium's runtime libraries. The t64 names come first: on Ubuntu 24.04 the old names are
  // virtual, and "libasound2" was satisfied by liboss4-salsa-asound2, an ALSA stand-in missing
  // symbols Chromium needs (it failed to start). Debian 12 falls through to the old names.
  writeFileSync(path.join(control, "control"), `Package: enki-browser
Version: ${pkg.version}
Section: web
Priority: optional
Architecture: amd64
Maintainer: Enki contributors <https://github.com/danilogiles/enki-browser>
Homepage: https://github.com/danilogiles/enki-browser
Installed-Size: ${sizeKb}
Depends: ca-certificates, fonts-liberation, libasound2t64 | libasound2, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatk1.0-0t64 | libatk1.0-0, libc6, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libudev1, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, xdg-utils
Description: Private browser with an AI assistant built in
 Enki Browser is ungoogled-chromium with the Enki assistant in the side panel,
 tracker and phishing blocking, and privacy defaults. Bring your own model.
`);
  writeFileSync(path.join(control, "postinst"), `#!/bin/sh
set -e
if command -v apparmor_parser >/dev/null 2>&1 && [ -d /sys/kernel/security/apparmor ]; then
  apparmor_parser -r /etc/apparmor.d/enki-browser || true
fi
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
exit 0
`);
  writeFileSync(path.join(control, "postrm"), `#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  command -v apparmor_parser >/dev/null 2>&1 && apparmor_parser -R /etc/apparmor.d/enki-browser 2>/dev/null || true
  # Files Chromium generated beside the extensions when run as root are not the package's own.
  rm -rf /opt/enki-browser
fi
exit 0
`);
  for (const f of ["postinst", "postrm"]) chmodSync(path.join(control, f), 0o755);
  const debName = `enki-browser_${pkg.version}_amd64.deb`;
  const debPath = path.join(out, debName);
  run("dpkg-deb", ["--root-owner-group", "--build", deb, debPath]);
  writeFileSync(`${debPath}.sha256`, `${hash(debPath)}  ${debName}\n`);
  rmSync(deb, { recursive: true, force: true });
} else {
  console.log("  dpkg-deb not found: skipping the .deb");
}

console.log(`\n✓ out/linux/enki-browser, out/${tarName}${hasDpkg ? `, out/enki-browser_${pkg.version}_amd64.deb` : ""}`);
console.log(JSON.stringify(version, null, 2));

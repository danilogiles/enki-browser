// Assembles Enki Browser for Windows from pinned upstream artifacts. Windows only: it relies on
// the bsdtar that ships with Windows 10+ and the .NET Framework C# compiler. build-linux.mjs is
// the Linux counterpart; what both share is in common.mjs.
//
//   node build/build.mjs              full build → out/EnkiBrowser, the zip and EnkiBrowserSetup-<ver>.exe
//   ENKI_DIST=<path> node build/...   use an already built Enki dist/ instead of cloning (local dev)
//
// Nothing here compiles Chromium. The browser is ungoogled-chromium's official build; what makes
// it Enki Browser is the extensions, the defaults and the launcher that ties them together.
import { createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addExtensions, extract, fetchPinned, findRoot, hash, out, pkg, rebrand, root, run, step, upstream, versionInfo, writeDefaults } from "./common.mjs";

const updateKeyFile = process.env.UPDATE_PUBLIC_KEY_FILE ?? path.join(root, "config", "update-signing.pub");
// out/EnkiBrowser is the install layout: the stub and `current` at the top, this release in
// app/<version>/ (see launcher/Install.cs).
const installRoot = path.join(out, "EnkiBrowser");
const app = path.join(installRoot, "app", pkg.version);
const TAR = path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");

if (process.platform !== "win32") throw new Error("build.mjs builds the Windows edition; use build-linux.mjs on Linux.");

// ---------------------------------------------------------------- icon
/** Builds a Windows .ico that embeds PNGs directly (supported since Vista). */
function pngsToIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    const e = Buffer.alloc(16);
    e.writeUInt8(w >= 256 ? 0 : w, 0);
    e.writeUInt8(h >= 256 ? 0 : h, 1);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

function findCsc() {
  const candidates = [
    path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    path.join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  const csc = candidates.find(existsSync);
  if (!csc) throw new Error("The .NET Framework C# compiler (csc.exe) was not found.");
  return csc;
}

// ---------------------------------------------------------------- code signing
/**
 * Signs a Windows executable when ENKI_SIGN_COMMAND is set, e.g. a signtool line for Azure
 * Trusted Signing or SignPath, with {file} where the path goes. Unset (local builds, forks), files
 * stay unsigned. Code-signing keys now live only in hardware or cloud HSMs, so this is a command
 * to call rather than a certificate file to load.
 */
function signFile(file) {
  const template = process.env.ENKI_SIGN_COMMAND;
  if (!template) return false;
  execFileSync(template.replaceAll("{file}", `"${file}"`), { stdio: "inherit", shell: true });
  return true;
}

// ---------------------------------------------------------------- build
step("Cleaning out/");
rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

step(`Fetching ${upstream.chromium.name} ${upstream.chromium.version}`);
const chromiumZip = await fetchPinned(upstream.chromium);
const chromiumTmp = path.join(out, "_chromium");
extract(chromiumZip, chromiumTmp);
cpSync(findRoot(chromiumTmp, "chrome.exe"), path.join(app, "chromium"), { recursive: true });
rmSync(chromiumTmp, { recursive: true, force: true });

const ext = await addExtensions(app);
const pngs = [16, 32, 48, 128, 256].map((s) => path.join(ext.iconDir, `icon${s}.png`)).filter(existsSync).map((f) => readFileSync(f));
const ico = path.join(out, "enki.ico");
writeFileSync(ico, pngsToIco(pngs));

step("Enki Browser's look and name");
// No theme extension: the window follows the system's light or dark mode, like other browsers.
rebrand(path.join(app, "chromium"));
// chrome.exe's version strings are what Task Manager and "Open with" call it.
const rcedit = await fetchPinned(upstream.rcedit);
run(rcedit, [
  path.join(app, "chromium", "chrome.exe"),
  "--set-version-string", "FileDescription", "Enki Browser",
  "--set-version-string", "ProductName", "Enki Browser",
  "--set-version-string", "CompanyName", "Enki contributors",
]);
// Icons: chrome.exe's is the file's icon, but Chromium draws its windows' taskbar and Alt+Tab icon
// from chrome.dll. Every icon group in both is replaced, then read back to prove it.
const iconPatch = path.join(out, "IconPatch.exe");
run(findCsc(), ["/nologo", "/target:exe", "/optimize+", "/platform:x64", `/out:${iconPatch}`, path.join(root, "build", "IconPatch.cs")]);
for (const file of ["chrome.exe", "chrome.dll"]) {
  const target = path.join(app, "chromium", file);
  run(iconPatch, [target, ico]);
  run(iconPatch, ["--verify", target, ico]);
}
rmSync(iconPatch);

step("Writing browser defaults");
writeDefaults(path.join(app, "chromium"), path.join(app, "config"), ext.enkiId);

step("Compiling the stub, the launcher and the installer");
// The updater trusts exactly one key, compiled in: the public half of the release signing key.
// The assembly attributes give each program its name and version in Windows.
const jwk = createPublicKey(readFileSync(updateKeyFile)).export({ format: "jwk" });
const b64 = (u) => Buffer.from(u, "base64url").toString("base64");
const buildInfo = path.join(out, "BuildInfo.g.cs");
writeFileSync(buildInfo, `// Generated by build.mjs. Do not edit.
using System.Reflection;
[assembly: AssemblyTitle("Enki Browser")]
[assembly: AssemblyProduct("Enki Browser")]
[assembly: AssemblyCompany("Enki contributors")]
[assembly: AssemblyVersion("${pkg.version}.0")]
[assembly: AssemblyFileVersion("${pkg.version}.0")]

static class UpdateKey
{
    public const string Modulus = "${b64(jwk.n)}";
    public const string Exponent = "${b64(jwk.e)}";
}
`);
const src = (f) => path.join(root, "launcher", f);
const csc = (outFile, sources, extra = []) => run(findCsc(), [
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64", `/win32icon:${ico}`,
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Core.dll", "/r:Microsoft.CSharp.dll",
  "/r:System.Web.Extensions.dll", "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
  ...extra, `/out:${outFile}`, ...sources, buildInfo,
]);
// Shortcuts point at the stub, which updates never replace; each version brings its own launcher.
csc(path.join(installRoot, "EnkiBrowser.exe"), [src("Stub.cs"), src("Common.cs"), src("Install.cs")]);
csc(path.join(app, "EnkiBrowserLauncher.exe"), [src("Launcher.cs"), src("Updater.cs"), src("Common.cs"), src("Install.cs")]);
// Signed before packaging, so the zip and the installer carry signed programs. chrome.exe is
// included because rcedit changed it; the rest of Chromium is shipped as ungoogled-chromium built it.
const signed = [path.join(installRoot, "EnkiBrowser.exe"), path.join(app, "EnkiBrowserLauncher.exe"), path.join(app, "chromium", "chrome.exe")].map(signFile);
console.log(signed.every(Boolean) ? "  signed EnkiBrowser.exe, EnkiBrowserLauncher.exe, chrome.exe" : "  not signed (ENKI_SIGN_COMMAND is not set)");
writeFileSync(path.join(installRoot, "current"), pkg.version);
cpSync(ico, path.join(app, "enki.ico"));

step("Licenses and version");
cpSync(path.join(root, "THIRD_PARTY.md"), path.join(app, "THIRD_PARTY.md"));
cpSync(path.join(root, "LICENSE"), path.join(app, "LICENSE"));
const version = versionInfo({
  chromium: upstream.chromium.version,
  blocker: upstream.blocker.version,
  enki: ext.enkiVersion,
  enkiExtensionId: ext.enkiId,
  shieldExtensionId: ext.shieldId,
});
writeFileSync(path.join(app, "version.json"), JSON.stringify(version, null, 2));

step("Packaging");
// The zip is the install layout itself: extract it anywhere to run (add a "portable" file to keep
// the profile beside it), and the updater takes app\<version>\ out of it.
const zipName = `EnkiBrowser-${pkg.version}-windows-x64.zip`;
const zipPath = path.join(out, zipName);
run(TAR, ["-a", "-c", "-f", zipPath, "-C", out, "EnkiBrowser"]);
writeFileSync(`${zipPath}.sha256`, `${hash(zipPath)}  ${zipName}\n`);
// The installer is one file: the same zip, embedded as a resource.
const setupName = `EnkiBrowserSetup-${pkg.version}.exe`;
const setupPath = path.join(out, setupName);
csc(setupPath, [path.join(root, "installer", "Setup.cs"), src("Common.cs"), src("Install.cs")], [`/resource:${zipPath},payload.zip`]);
signFile(setupPath);
writeFileSync(`${setupPath}.sha256`, `${hash(setupPath)}  ${setupName}\n`);
rmSync(buildInfo);
rmSync(ico);
console.log(`\n✓ out/EnkiBrowser, out/${zipName}, out/${setupName}`);
console.log(JSON.stringify(version, null, 2));

// Assembles Enki Browser for Windows from pinned upstream artifacts. Windows only: it relies on
// the bsdtar that ships with Windows 10+ and the .NET Framework C# compiler. build-linux.mjs is
// the Linux counterpart; what both share is in common.mjs.
//
//   node build/build.mjs              full build → out/EnkiBrowser, the zip and EnkiBrowserSetup-<ver>.exe
//   ENKI_DIST=<path> node build/...   use an already built Enki dist/ instead of building extension/
//
// The same build in three phases, so a signer outside this script (CI's Azure Artifact Signing
// step) can sign between them; a plain run does all three, signing with ENKI_SIGN_COMMAND if set:
//   --phase=programs    everything up to the compiled stub and launcher (sign those two next)
//   --phase=package     the portable zip and the installer around the signed programs (sign the installer next)
//   --phase=checksums   the .sha256 files, over the bytes that ship
//
// Nothing here compiles Chromium. The browser is ungoogled-chromium's official build; what makes
// it Enki Browser is the extensions, the defaults and the launcher that ties them together.
import { createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { addExtensions, brand, extract, fetchPinned, findRoot, hash, out, pkg, rebrand, replaceLogos, root, run, step, upstream, versionInfo, writeDefaults } from "./common.mjs";

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
 * Artifact Signing, with {file} where the path goes. Unset (local builds, forks), files stay
 * unsigned. Code-signing keys now live only in hardware or cloud HSMs, so this is a command to
 * call rather than a certificate file to load. Only the programs this project compiles are ever
 * passed here; upstream chrome.exe and the rest of ungoogled-chromium ship as they were built.
 */
function signFile(file) {
  const template = process.env.ENKI_SIGN_COMMAND;
  if (!template) return false;
  execFileSync(template.replaceAll("{file}", `"${file}"`), { stdio: "inherit", shell: true });
  return true;
}

// ---------------------------------------------------------------- phases
const PHASES = ["programs", "package", "checksums"];
const phaseArg = process.argv.slice(2).find((a) => a.startsWith("--phase="));
const phase = phaseArg ? phaseArg.slice("--phase=".length) : "all";
if (phase !== "all" && !PHASES.includes(phase)) throw new Error(`Unknown ${phaseArg}; expected one of ${PHASES.join(", ")}.`);
const runs = (p) => phase === "all" || phase === p;
// What one phase leaves for the next: everything lives under out/.
const ico = path.join(out, "enki.ico");
const buildInfo = path.join(out, "BuildInfo.g.cs");
const stub = path.join(installRoot, "EnkiBrowser.exe");
const launcher = path.join(app, "EnkiBrowserLauncher.exe");
const zipName = `EnkiBrowser-${pkg.version}-windows-x64.zip`;
const zipPath = path.join(out, zipName);
const setupName = `EnkiBrowserSetup-${pkg.version}.exe`;
const setupPath = path.join(out, setupName);
const needs = (files, earlier) => {
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) throw new Error(`Run --phase=${earlier} first; missing ${missing.map((f) => path.relative(out, f)).join(", ")}.`);
};
const src = (f) => path.join(root, "launcher", f);
const csc = (outFile, sources, extra = []) => run(findCsc(), [
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64", `/win32icon:${ico}`,
  "/r:System.Windows.Forms.dll", "/r:System.Drawing.dll", "/r:System.Core.dll", "/r:Microsoft.CSharp.dll",
  "/r:System.Web.Extensions.dll", "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
  ...extra, `/out:${outFile}`, ...sources, buildInfo,
]);

// ---------------------------------------------------------------- build
if (runs("programs")) {
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
  // The plated app icon, at the sizes Windows asks for (16–64 across DPI scales, 256 for large views).
  const pngs = [16, 20, 24, 32, 40, 48, 64, 256].map((s) => readFileSync(path.join(brand, "icons", `enki-browser-${s}.png`)));
  writeFileSync(ico, pngsToIco(pngs));

  step("Enki Browser's look and name");
  // No theme extension: the window follows the system's light or dark mode, like other browsers.
  rebrand(path.join(app, "chromium"));
  await replaceLogos(path.join(app, "chromium"), upstream.chromium.version);
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
  writeDefaults(path.join(app, "chromium"), path.join(app, "config"), ext.enkiId, ext.shieldId);

  step("Compiling the stub and the launcher");
  // The updater trusts exactly one key, compiled in: the public half of the release signing key.
  // The assembly attributes give each program its name and version in Windows.
  const jwk = createPublicKey(readFileSync(updateKeyFile)).export({ format: "jwk" });
  const b64 = (u) => Buffer.from(u, "base64url").toString("base64");
  writeFileSync(buildInfo, `// Generated by build.mjs. Do not edit.
using System.Reflection;
[assembly: AssemblyTitle("Enki Browser")]
[assembly: AssemblyProduct("Enki Browser")]
[assembly: AssemblyCompany("Danilo De Souza")]
[assembly: AssemblyVersion("${pkg.version}.0")]
[assembly: AssemblyFileVersion("${pkg.version}.0")]

static class UpdateKey
{
    public const string Modulus = "${b64(jwk.n)}";
    public const string Exponent = "${b64(jwk.e)}";
}
`);
  // Shortcuts point at the stub, which updates never replace; each version brings its own launcher.
  csc(stub, [src("Stub.cs"), src("Common.cs"), src("Install.cs")]);
  csc(launcher, [src("Launcher.cs"), src("Updater.cs"), src("NativeHost.cs"), src("Migration.cs"), src("Watcher.cs"), src("ShellIdentity.cs"), src("Common.cs"), src("Install.cs")]);
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
  console.log(JSON.stringify(version, null, 2));

  // Signed before packaging, so the zip and the installer carry signed programs. Only the two
  // programs compiled above: chrome.exe and the rest of Chromium ship as ungoogled-chromium built
  // them (plus the name and icon changes above), never under this project's certificate.
  const signed = [stub, launcher].map(signFile);
  console.log(signed.every(Boolean) ? "  signed EnkiBrowser.exe, EnkiBrowserLauncher.exe" : "  not signed here (ENKI_SIGN_COMMAND is not set)");
}

if (runs("package")) {
  needs([stub, launcher, ico, buildInfo], "programs");
  step("Packaging");
  // Each version carries the stub it was built with; the launcher puts it in place once the browser
  // has closed (Updater.RefreshStub), so the stub's icon and fixes reach existing installs. Copied
  // here, after signing, so both copies are the signed file.
  cpSync(stub, path.join(app, "EnkiBrowser.exe"));
  writeFileSync(path.join(installRoot, "current"), pkg.version);
  // The zip is the install layout itself: extract it anywhere to run (add a "portable" file to keep
  // the profile beside it), and the updater takes app\<version>\ out of it.
  rmSync(zipPath, { force: true });
  run(TAR, ["-a", "-c", "-f", zipPath, "-C", out, "EnkiBrowser"]);
  // The installer is one file: the same zip, embedded as a resource.
  csc(setupPath, [path.join(root, "installer", "Setup.cs"), src("Common.cs"), src("Install.cs")], [`/resource:${zipPath},payload.zip`]);
  signFile(setupPath);
}

if (runs("checksums")) {
  needs([zipPath, setupPath], "package");
  step("Checksums");
  // Last, so each hash is of the bytes that ship: the zip as packed, the installer as signed.
  writeFileSync(`${zipPath}.sha256`, `${hash(zipPath)}  ${zipName}\n`);
  writeFileSync(`${setupPath}.sha256`, `${hash(setupPath)}  ${setupName}\n`);
  rmSync(buildInfo, { force: true });
  rmSync(ico, { force: true });
  console.log(`\n✓ out/EnkiBrowser, out/${zipName}, out/${setupName}`);
}

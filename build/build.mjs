// Assembles Enki Browser from pinned upstream artifacts. Windows only: it relies on the
// bsdtar that ships with Windows 10+ (`tar -xf x.zip`) and the .NET Framework C# compiler.
//
//   node build/build.mjs              full build → out/EnkiBrowser and out/EnkiBrowser-<ver>-windows-x64.zip
//   ENKI_DIST=<path> node build/...   use an already built Enki dist/ instead of cloning (local dev)
//
// Nothing here compiles Chromium. The browser is ungoogled-chromium's official build; what makes
// it Enki Browser is the extensions, the defaults and the launcher that ties them together.
import { createHash, createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rebrandLocales } from "./rebrand.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = JSON.parse(readFileSync(path.join(root, "upstream.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// Tests build throwaway versions and sign them with a throwaway key; releases use neither override.
if (process.env.ENKI_VERSION) pkg.version = process.env.ENKI_VERSION;
const updateKeyFile = process.env.UPDATE_PUBLIC_KEY_FILE ?? path.join(root, "config", "update-signing.pub");
const cache = path.join(root, "cache");
const out = path.join(root, "out");
const app = path.join(out, "EnkiBrowser");

const step = (msg) => console.log(`\n▸ ${msg}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
// Windows' own bsdtar reads and writes zip. A GNU tar from Git or MSYS earlier on PATH does
// not, and mistakes "C:" for a remote host, so never rely on PATH for this one.
const TAR = path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe");

if (process.platform !== "win32") throw new Error("Enki Browser currently builds on Windows only.");

// ---------------------------------------------------------------- inputs
async function fetchPinned({ name, url, sha256 }) {
  mkdirSync(cache, { recursive: true });
  const file = path.join(cache, path.basename(new URL(url).pathname));
  if (!existsSync(file) || hash(file) !== sha256) {
    console.log(`  downloading ${name} from ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} for ${url}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  } else {
    console.log(`  ${name}: using cached ${path.basename(file)}`);
  }
  // A mismatch is never "close enough": it is a different file than the one that was reviewed.
  const actual = hash(file);
  if (actual !== sha256) {
    rmSync(file);
    throw new Error(`${name}: sha256 mismatch.\n  expected ${sha256}\n  got      ${actual}`);
  }
  console.log(`  ${name}: sha256 verified`);
  return file;
}

function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function unzip(zip, dest) {
  mkdirSync(dest, { recursive: true });
  run(TAR, ["-xf", zip, "-C", dest]);
}

/** Zips often wrap everything in one top-level folder; return the folder that holds `marker`. */
function findRoot(dir, marker) {
  if (existsSync(path.join(dir, marker))) return dir;
  for (const entry of readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (statSync(sub).isDirectory() && existsSync(path.join(sub, marker))) return sub;
  }
  throw new Error(`Could not find ${marker} under ${dir}`);
}

function buildEnki() {
  if (process.env.ENKI_DIST) {
    const dist = path.resolve(process.env.ENKI_DIST);
    if (!existsSync(path.join(dist, "manifest.json"))) throw new Error(`ENKI_DIST has no manifest.json: ${dist}`);
    console.log(`  using ENKI_DIST=${dist}`);
    return dist;
  }
  const src = path.join(cache, "enki-src");
  rmSync(src, { recursive: true, force: true });
  run("git", ["clone", "--depth", "1", "--branch", upstream.enki.ref, upstream.enki.repo, src]);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci"], { cwd: src, shell: true });
  run(npm, ["run", "build"], { cwd: src, shell: true });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: src }).toString().trim();
  console.log(`  built Enki at ${commit}`);
  return path.join(src, "dist");
}

// ---------------------------------------------------------------- extension identity
/**
 * An unpacked extension's id is derived from its folder path, so it would change with every
 * install location — and with it the storage that holds the user's settings, and any way to pin
 * it. Giving the manifest a fixed public key makes the id the same everywhere. Only the public
 * half exists; unpacked extensions are never signed, so there is no private key to protect.
 */
function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

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

// ---------------------------------------------------------------- build
step("Cleaning out/");
rmSync(out, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

step(`Fetching ${upstream.chromium.name} ${upstream.chromium.version}`);
const chromiumZip = await fetchPinned(upstream.chromium);
const chromiumTmp = path.join(out, "_chromium");
unzip(chromiumZip, chromiumTmp);
cpSync(findRoot(chromiumTmp, "chrome.exe"), path.join(app, "chromium"), { recursive: true });
rmSync(chromiumTmp, { recursive: true, force: true });

step(`Fetching ${upstream.blocker.name} ${upstream.blocker.version}`);
const blockerZip = await fetchPinned(upstream.blocker);
const blockerTmp = path.join(out, "_blocker");
unzip(blockerZip, blockerTmp);
cpSync(findRoot(blockerTmp, "manifest.json"), path.join(app, "extensions", "ublock-lite"), { recursive: true });
rmSync(blockerTmp, { recursive: true, force: true });

step("Building Enki");
const enkiDist = buildEnki();
const enkiDir = path.join(app, "extensions", "enki");
cpSync(enkiDist, enkiDir, { recursive: true });
const enkiKey = readFileSync(path.join(root, "config", "enki-extension.pub"), "utf8").trim();
createPublicKey({ key: Buffer.from(enkiKey, "base64"), format: "der", type: "spki" }); // must be a real key
const enkiManifestPath = path.join(enkiDir, "manifest.json");
const enkiManifest = JSON.parse(readFileSync(enkiManifestPath, "utf8"));
enkiManifest.key = enkiKey;
// Enki ships Enki Home but leaves the new tab alone, so people who install the extension in their
// own browser keep theirs. In Enki Browser it is the start page.
const homePage = "src/home/index.html";
if (existsSync(path.join(enkiDir, homePage))) {
  enkiManifest.chrome_url_overrides = { newtab: homePage };
  console.log("  Enki Home is the new tab page");
} else {
  console.log("  this Enki has no Enki Home; keeping Chromium's new tab page");
}
writeFileSync(enkiManifestPath, JSON.stringify(enkiManifest, null, 2));
const enkiId = extensionIdFromKey(enkiKey);
console.log(`  Enki extension id: ${enkiId} (Enki ${enkiManifest.version})`);

// Windows wants 256px for the taskbar and Start menu on high-DPI screens; older Enki builds only
// have up to 128px, and the icon is still correct, just softer there.
const iconDir = existsSync(path.join(enkiDir, "icons", "icon16.png")) ? path.join(enkiDir, "icons") : path.join(enkiDir, "public", "icons");
const pngs = [16, 32, 48, 128, 256].map((s) => path.join(iconDir, `icon${s}.png`)).filter(existsSync).map((f) => readFileSync(f));
const ico = path.join(out, "enki.ico");
writeFileSync(ico, pngsToIco(pngs));

step("Enki Browser's look and name");
cpSync(path.join(root, "theme"), path.join(app, "extensions", "theme"), { recursive: true });
// Enki Shield, with a fixed id like Enki's so its downloaded list survives reinstalls.
const shieldDir = path.join(app, "extensions", "shield");
cpSync(path.join(root, "shield"), shieldDir, { recursive: true });
const shieldKey = readFileSync(path.join(root, "config", "shield-extension.pub"), "utf8").trim();
const shieldManifest = JSON.parse(readFileSync(path.join(shieldDir, "manifest.json"), "utf8"));
shieldManifest.key = shieldKey;
writeFileSync(path.join(shieldDir, "manifest.json"), JSON.stringify(shieldManifest, null, 2));
const shieldId = extensionIdFromKey(shieldKey);
console.log(`  Enki Shield id: ${shieldId}`);
const renamed = rebrandLocales(path.join(app, "chromium", "locales"), "Enki Browser");
const counts = Object.values(renamed);
console.log(`  renamed Chromium → Enki Browser in ${counts.reduce((a, b) => a + b, 0)} strings across ${counts.length} languages`);
// chrome.exe's icon is what Windows shows for every browser window, in the taskbar and Alt+Tab;
// its version strings are what Task Manager and "Open with" call it.
const rcedit = await fetchPinned(upstream.rcedit);
run(rcedit, [
  path.join(app, "chromium", "chrome.exe"),
  "--set-icon", ico,
  "--set-version-string", "FileDescription", "Enki Browser",
  "--set-version-string", "ProductName", "Enki Browser",
  "--set-version-string", "CompanyName", "Enki contributors",
]);

step("Writing browser defaults");
const prefs = JSON.parse(readFileSync(path.join(root, "config", "initial_preferences.json"), "utf8"));
prefs.extensions = { ...(prefs.extensions ?? {}), pinned_extensions: [enkiId] };
// Chromium reads this file from the folder of chrome.exe the first time a profile is created.
writeFileSync(path.join(app, "chromium", "initial_preferences"), JSON.stringify(prefs, null, 2));
mkdirSync(path.join(app, "config"), { recursive: true });
cpSync(path.join(root, "config", "flags.txt"), path.join(app, "config", "flags.txt"));

step("Compiling the launcher");
// The updater trusts exactly one key, compiled in: the public half of the release signing key.
// The assembly attributes give EnkiBrowser.exe its name and version in Windows.
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
run(findCsc(), [
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64",
  `/win32icon:${ico}`,
  "/r:System.Windows.Forms.dll", "/r:System.Core.dll", "/r:System.Web.Extensions.dll",
  "/r:System.IO.Compression.dll", "/r:System.IO.Compression.FileSystem.dll",
  `/out:${path.join(app, "EnkiBrowser.exe")}`,
  path.join(root, "launcher", "EnkiBrowser.cs"), path.join(root, "launcher", "Updater.cs"), buildInfo,
]);
rmSync(buildInfo);
cpSync(ico, path.join(app, "enki.ico"));

step("Installer, licenses, version");
for (const f of ["install.ps1", "uninstall.ps1", "Install Enki Browser.cmd"]) cpSync(path.join(root, "installer", f), path.join(app, f));
cpSync(path.join(root, "THIRD_PARTY.md"), path.join(app, "THIRD_PARTY.md"));
cpSync(path.join(root, "LICENSE"), path.join(app, "LICENSE"));
const version = {
  enkiBrowser: pkg.version,
  chromium: upstream.chromium.version,
  blocker: upstream.blocker.version,
  enki: enkiManifest.version,
  enkiExtensionId: enkiId,
  shieldExtensionId: shieldId,
  builtAt: new Date().toISOString(),
};
writeFileSync(path.join(app, "version.json"), JSON.stringify(version, null, 2));

step("Packaging");
const zipName = `EnkiBrowser-${pkg.version}-windows-x64.zip`;
run(TAR, ["-a", "-c", "-f", path.join(out, zipName), "-C", out, "EnkiBrowser"]);
writeFileSync(path.join(out, `${zipName}.sha256`), `${hash(path.join(out, zipName))}  ${zipName}\n`);
rmSync(ico);
console.log(`\n✓ out/EnkiBrowser and out/${zipName}`);
console.log(JSON.stringify(version, null, 2));

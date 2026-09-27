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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = JSON.parse(readFileSync(path.join(root, "upstream.json"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
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
writeFileSync(enkiManifestPath, JSON.stringify(enkiManifest, null, 2));
const enkiId = extensionIdFromKey(enkiKey);
console.log(`  Enki extension id: ${enkiId} (Enki ${enkiManifest.version})`);

step("Writing browser defaults");
const prefs = JSON.parse(readFileSync(path.join(root, "config", "initial_preferences.json"), "utf8"));
prefs.extensions = { ...(prefs.extensions ?? {}), pinned_extensions: [enkiId] };
// Chromium reads this file from the folder of chrome.exe the first time a profile is created.
writeFileSync(path.join(app, "chromium", "initial_preferences"), JSON.stringify(prefs, null, 2));
mkdirSync(path.join(app, "config"), { recursive: true });
cpSync(path.join(root, "config", "flags.txt"), path.join(app, "config", "flags.txt"));

step("Compiling the launcher");
const pngs = [16, 32, 48, 128].map((s) => readFileSync(path.join(enkiDir, "public", "icons", `icon${s}.png`)));
const ico = path.join(out, "enki.ico");
writeFileSync(ico, pngsToIco(pngs));
run(findCsc(), [
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64",
  `/win32icon:${ico}`, "/r:System.Windows.Forms.dll",
  `/out:${path.join(app, "EnkiBrowser.exe")}`,
  path.join(root, "launcher", "EnkiBrowser.cs"),
]);
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

// What the Windows and Linux builds share: pinned downloads, Enki and the built-in extensions with
// fixed ids, the Enki Browser name in Chromium's UI, and the first-run defaults.
import { createHash, createPublicKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { readPak, rebrandLocaleFiles, rebrandLocales, writePak } from "./rebrand.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const upstream = JSON.parse(readFileSync(path.join(root, "upstream.json"), "utf8"));
export const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
// Tests build throwaway versions and sign them with a throwaway key; releases use neither override.
if (process.env.ENKI_VERSION) pkg.version = process.env.ENKI_VERSION;
export const cache = path.join(root, "cache");
export const out = path.join(root, "out");
/** Enki Browser's own icons and logos (brand/README.md): the plated app icon and the unplated mark. */
export const brand = path.join(root, "brand");

export const step = (msg) => console.log(`\n▸ ${msg}`);
export const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

export function hash(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export async function fetchPinned({ name, url, sha256 }) {
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

/**
 * Unpacks a .zip or .tar.xz. On Windows, its own bsdtar handles zip; a GNU tar from Git or MSYS
 * earlier on PATH does not, and mistakes "C:" for a remote host, so its path is fixed. On Linux,
 * unzip and tar do.
 */
export function extract(archive, dest) {
  mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    run(path.join(process.env.WINDIR ?? "C:\\Windows", "System32", "tar.exe"), ["-xf", archive, "-C", dest]);
  } else if (archive.endsWith(".zip")) {
    run("unzip", ["-q", "-o", archive, "-d", dest]);
  } else {
    run("tar", ["-xf", archive, "-C", dest]);
  }
}

/** Archives often wrap everything in one top-level folder; return the folder that holds `marker`. */
export function findRoot(dir, marker) {
  if (existsSync(path.join(dir, marker))) return dir;
  for (const entry of readdirSync(dir)) {
    const sub = path.join(dir, entry);
    if (statSync(sub).isDirectory() && existsSync(path.join(sub, marker))) return sub;
  }
  throw new Error(`Could not find ${marker} under ${dir}`);
}

export function buildEnki() {
  if (process.env.ENKI_DIST) {
    const dist = path.resolve(process.env.ENKI_DIST);
    if (!existsSync(path.join(dist, "manifest.json"))) throw new Error(`ENKI_DIST has no manifest.json: ${dist}`);
    console.log(`  using ENKI_DIST=${dist}`);
    return dist;
  }
  // Enki lives in extension/ (until October 2026 it was cloned from danilogiles/enkibrowser at
  // build time), so a release is one commit: the browser and the assistant it ships, together.
  const src = path.join(root, "extension");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["ci"], { cwd: src, shell: true });
  run(npm, ["run", "build"], { cwd: src, shell: true });
  console.log(`  built Enki from extension/`);
  return path.join(src, "dist");
}

/**
 * An unpacked extension's id is derived from its folder path, so it would change with every
 * install location — and with it the storage that holds the user's settings, and any way to pin
 * it. Giving the manifest a fixed public key makes the id the same everywhere. Only the public
 * half exists; unpacked extensions are never signed, so there is no private key to protect.
 */
export function extensionIdFromKey(keyB64) {
  const der = Buffer.from(keyB64, "base64");
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

function withKey(dir, keyFile, extra = {}) {
  const key = readFileSync(path.join(root, "config", keyFile), "utf8").trim();
  createPublicKey({ key: Buffer.from(key, "base64"), format: "der", type: "spki" }); // must be a real key
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = { ...JSON.parse(readFileSync(manifestPath, "utf8")), key, ...extra };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { id: extensionIdFromKey(key), manifest };
}

/**
 * Gives an extension's background service worker a file name that changes with its contents.
 *
 * Chromium keeps an extension's service worker, with every module it imports, in the profile's
 * service worker store, and for extensions loaded from the command line it never replaced it:
 * after an update the extension's pages were new but its background script was still the one
 * from the first install (seen with Enki 0.3.0 running 0.2.0's worker, so its startup fix never
 * ran). Clearing Chromium's record of the registration in Secure Preferences, or the extension's
 * whole entry, did not help, and deleting the store would take every website's service workers
 * with it. A new script URL does work: Chromium has to register it, and the new code runs.
 */
function freshWorker(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const worker = manifest.background?.service_worker;
  if (!worker) return;
  const digest = createHash("sha256");
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p !== manifestPath) digest.update(path.relative(dir, p)).update(readFileSync(p));
    }
  };
  walk(dir);
  const renamed = worker.replace(/(\.m?js)$/, `-${digest.digest("hex").slice(0, 10)}$1`);
  cpSync(path.join(dir, worker), path.join(dir, renamed));
  manifest.background.service_worker = renamed;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Appends patches/ublock-lite-shields.js to uBlock's background script: Enki Shield's Shields
 * panel may then read and set a site's filtering mode (and nothing else). The anchor check fails
 * the build if a uBlock update reshapes the file, rather than shipping a patch that never runs.
 */
function patchBlocker(dir, shieldId) {
  const file = path.join(dir, "js", "background.js");
  const source = readFileSync(file, "utf8");
  for (const anchor of ["runtime.onMessage.addListener((request, sender, callback) => {", "case 'setFilteringMode':", "case 'setDefaultFilteringMode':"]) {
    if (!source.includes(anchor)) throw new Error(`uBlock Origin Lite changed: "${anchor}" is no longer in js/background.js; update patches/ublock-lite-shields.js`);
  }
  const patch = readFileSync(path.join(root, "patches", "ublock-lite-shields.js"), "utf8").replace("__ENKI_SHIELD_ID__", shieldId);
  writeFileSync(file, source + patch);
  console.log("  uBlock Origin Lite patched for the Shields panel (patches/ublock-lite-shields.js)");
}

/** Copies the built-in extensions into <app>/extensions and returns their ids. */
export async function addExtensions(app) {
  step(`Fetching ${upstream.blocker.name} ${upstream.blocker.version}`);
  const blockerZip = await fetchPinned(upstream.blocker);
  const blockerTmp = path.join(out, "_blocker");
  extract(blockerZip, blockerTmp);
  const blockerDir = path.join(app, "extensions", "ublock-lite");
  cpSync(findRoot(blockerTmp, "manifest.json"), blockerDir, { recursive: true });
  rmSync(blockerTmp, { recursive: true, force: true });
  // uBlock ships without a key, so its id came from its folder — app\<version>\… — and every
  // update gave it a new id and an empty storage: per-site modes and list choices were lost.
  const blocker = withKey(blockerDir, "ublock-extension.pub");
  console.log(`  uBlock Origin Lite id: ${blocker.id}`);

  step("Building Enki");
  const enkiDir = path.join(app, "extensions", "enki");
  cpSync(buildEnki(), enkiDir, { recursive: true });
  // Enki ships Enki Home but leaves the new tab alone, so people who install the extension in
  // their own browser keep theirs. In Enki Browser it is the start page.
  const homePage = "src/home/index.html";
  const hasHome = existsSync(path.join(enkiDir, homePage));
  const enki = withKey(enkiDir, "enki-extension.pub", hasHome ? { chrome_url_overrides: { newtab: homePage } } : {});
  console.log(hasHome ? "  Enki Home is the new tab page" : "  this Enki has no Enki Home; keeping Chromium's new tab page");
  console.log(`  Enki extension id: ${enki.id} (Enki ${enki.manifest.version})`);

  // Enki Shield, with a fixed id like Enki's so its downloaded list survives reinstalls.
  const shieldDir = path.join(app, "extensions", "shield");
  cpSync(path.join(root, "shield"), shieldDir, { recursive: true });
  const shield = withKey(shieldDir, "shield-extension.pub");
  console.log(`  Enki Shield id: ${shield.id}`);
  patchBlocker(blockerDir, shield.id);
  // Its settings page shows the Enki Browser version it shipped with ("Check for updates").
  writeFileSync(path.join(shieldDir, "ids.json"), JSON.stringify({ ublock: blocker.id, browser: pkg.version }));

  for (const dir of ["enki", "shield", "ublock-lite"]) freshWorker(path.join(app, "extensions", dir));

  // Icons up to 256 px live in icons/ (older Enki builds only had public/icons up to 128).
  const iconDir = existsSync(path.join(enkiDir, "icons", "icon16.png")) ? path.join(enkiDir, "icons") : path.join(enkiDir, "public", "icons");
  return { enkiId: enki.id, enkiVersion: enki.manifest.version, shieldId: shield.id, ublockId: blocker.id, iconDir };
}

/**
 * "Chromium" becomes "Enki Browser" across the UI, in every language, except where a string
 * credits the Chromium project; the About page's version line leads with Enki Browser's version.
 */
export function rebrand(chromiumDir, mac = null) {
  const report = mac
    ? rebrandLocaleFiles(mac.files, mac.english, "Enki Browser", pkg.version)
    : rebrandLocales(path.join(chromiumDir, "locales"), "Enki Browser", pkg.version);
  const counts = Object.values(report);
  console.log(`  renamed Chromium → Enki Browser in ${counts.reduce((a, b) => a + b, 0)} strings across ${counts.length} languages`);
}

/** Chromium's logo as it sits in its source tree; the build finds these exact files in the paks. */
const CHROMIUM_LOGOS = [
  "default_100_percent/chromium/product_logo_16.png", "default_100_percent/chromium/product_logo_32.png",
  "default_100_percent/chromium/product_logo_name_22.png", "default_200_percent/chromium/product_logo_16.png",
  "default_200_percent/chromium/product_logo_32.png", "default_200_percent/chromium/product_logo_name_22.png",
  "chromium/product_logo_16.png", "chromium/product_logo_24.png", "chromium/product_logo_32.png",
  "chromium/product_logo_48.png", "chromium/product_logo_64.png", "chromium/product_logo_128.png",
  "chromium/product_logo_256.png",
];

/**
 * Replaces Chromium's logo inside the resource paks (the About page, the profile menu and other
 * WebUI) with Enki's unplated mark (brand/logo-master.png), at the same pixel size. The logo images
 * are identified by being byte-for-byte the PNGs in Chromium's source at this exact version — never
 * guessed from size or position.
 */
export async function replaceLogos(chromiumDir, chromiumVersion) {
  const tag = chromiumVersion.replace(/-.*$/, "");
  const dir = path.join(cache, `chromium-logos-${tag}`);
  mkdirSync(dir, { recursive: true });
  const known = new Set();
  for (const rel of CHROMIUM_LOGOS) {
    const file = path.join(dir, rel.replaceAll("/", "_"));
    if (!existsSync(file)) {
      const res = await fetch(`https://raw.githubusercontent.com/chromium/chromium/${tag}/chrome/app/theme/${rel}`);
      if (!res.ok) continue; // not every file exists in every version
      writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    }
    known.add(hash(file));
  }
  const source = readFileSync(path.join(brand, "logo-master.png"));
  let replaced = 0;
  for (const name of ["chrome_100_percent.pak", "chrome_200_percent.pak", "resources.pak"]) {
    const file = path.join(chromiumDir, name);
    if (!existsSync(file)) continue;
    const pak = readPak(readFileSync(file));
    let changed = false;
    for (const r of pak.resources) {
      if (r.data[0] !== 0x89 || r.data[1] !== 0x50) continue; // PNG only
      if (!known.has(createHash("sha256").update(r.data).digest("hex"))) continue;
      const width = r.data.readUInt32BE(16), height = r.data.readUInt32BE(20);
      // Square logos are the mark; the wide ones (logo + name) get the mark on the left.
      const mark = await sharp(source).resize(height, height, { kernel: "lanczos3" }).png().toBuffer();
      r.data = width === height ? mark : await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: mark, left: 0, top: 0 }]).png().toBuffer();
      replaced++;
      changed = true;
    }
    if (changed) writeFileSync(file, writePak(pak));
  }
  // The About page is where people look for whose browser this is; failing loudly beats shipping
  // Chromium's logo because a path moved upstream.
  if (replaced < 6) throw new Error(`replaced only ${replaced} Chromium logo images; expected the About page's and others`);
  console.log(`  replaced Chromium's logo with Enki's in ${replaced} images`);
}

/** First-run defaults (read from next to the Chromium binary) and the launcher's switches. */
export function writeDefaults(chromiumDir, configDir, enkiId, shieldId) {
  const prefs = JSON.parse(readFileSync(path.join(root, "config", "initial_preferences.json"), "utf8"));
  // Enki, and Enki Shield's Shields button right of the address bar, as Brave's lion is.
  prefs.extensions = { ...(prefs.extensions ?? {}), pinned_extensions: [enkiId, shieldId].filter(Boolean) };
  writeFileSync(path.join(chromiumDir, "initial_preferences"), JSON.stringify(prefs, null, 2));
  mkdirSync(configDir, { recursive: true });
  cpSync(path.join(root, "config", "flags.txt"), path.join(configDir, "flags.txt"));
}

export function versionInfo(extra) {
  return { enkiBrowser: pkg.version, ...extra, builtAt: new Date().toISOString() };
}
